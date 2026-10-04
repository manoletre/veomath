// Generation backends. All three send the same system prompt, user message(s) and JSON schema
// that the app sends (app/api/shared/visualization.ts):
//   gateway — OpenAI-compatible API (Vercel AI Gateway), identical to the app's request
//   claude  — `claude -p` headless mode, billed to the Claude subscription
//   codex   — `codex exec`, billed to the ChatGPT subscription

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type OpenAI from 'openai';
import {
  buildChatMessages,
  requestVisualization,
  VISUALIZATION_RESPONSE_FORMAT,
  type ChatRequest,
  type Visualization,
} from '../app/api/shared/visualization';
import type { ModelConfig } from './types';

export interface GenerationOutput {
  visualization: Visualization;
  raw: string;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /** Cost reported by the CLI (API-equivalent; not billed on a subscription). null = compute from gateway prices. */
  reportedCostUsd: number | null;
}

/**
 * The model answered but the answer is unusable (invalid JSON / failed the schema) — scored as a failure.
 * Any other error (HTTP 4xx/5xx, rate limits, CLI crashes) is infrastructure: the item is skipped and
 * retried on resume instead of being scored 0.
 */
export class ModelOutputError extends Error {}

const CLI_TIMEOUT_MS = 10 * 60_000;
// Empty working directory so the CLIs don't pick up CLAUDE.md / AGENTS.md or project files.
const CLI_CWD = path.join(os.tmpdir(), 'veomath-eval');
const SCHEMA = VISUALIZATION_RESPONSE_FORMAT.json_schema.schema;

// Codex features that add tools/context irrelevant to a single structured answer.
const CODEX_DISABLED_FEATURES = [
  'apps', 'browser_use', 'browser_use_external', 'code_mode_host', 'goals', 'hooks', 'image_generation',
  'in_app_browser', 'mentions_v2', 'multi_agent', 'plugins', 'realtime_conversation', 'remote_plugin',
  'shell_snapshot', 'shell_tool', 'skill_mcp_dependency_install', 'skill_search', 'sleep_tool',
  'tool_suggest', 'unified_exec',
];

export async function generate(model: ModelConfig, request: ChatRequest, gateway: OpenAI | null): Promise<GenerationOutput> {
  if (model.via === 'gateway') {
    if (!gateway) throw new Error('AI_GATEWAY_API_KEY is not set');
    let result;
    try {
      result = await requestVisualization(gateway, model.id, request);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Model returned invalid JSON')) {
        throw new ModelOutputError(err.message, { cause: err.cause });
      }
      throw err;
    }
    const { visualization, raw, usage } = result;
    return {
      visualization,
      raw,
      inputTokens: usage?.prompt_tokens ?? null,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      reportedCostUsd: null,
    };
  }

  const { system, prompt } = flattenForCli(request);
  await mkdir(CLI_CWD, { recursive: true });
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const systemFile = path.join(CLI_CWD, `system-${tag}.md`);
  await writeFile(systemFile, system);

  return model.via === 'claude'
    ? runClaude(model, systemFile, prompt)
    : runCodex(model, systemFile, prompt, tag);
}

/** The CLIs take one system prompt + one user turn; join the user messages the app would send. */
function flattenForCli(request: ChatRequest) {
  const [system, ...rest] = buildChatMessages(request);
  const parts = rest.map((m) => {
    if (typeof m.content !== 'string') throw new Error('Image inputs are not supported by the CLI backends');
    return m.content;
  });
  return { system: system.content as string, prompt: parts.join('\n\n') };
}

async function runClaude(model: ModelConfig, systemFile: string, prompt: string): Promise<GenerationOutput> {
  const args = [
    '-p',
    '--model', model.cliModel ?? model.id,
    '--system-prompt-file', systemFile,
    '--json-schema', JSON.stringify(SCHEMA),
    '--output-format', 'json',
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
    '--no-session-persistence',
    ...(model.effort ? ['--effort', model.effort] : []),
  ];
  const stdout = await run('claude', args, prompt);
  const out = JSON.parse(stdout);
  if (out.is_error || out.subtype !== 'success') {
    const message = `claude: ${out.subtype ?? 'error'} ${out.api_error_status ?? ''} ${out.result ?? ''}`.trim();
    // API errors (auth, rate limit, overload) are infrastructure; anything else is the model failing to answer.
    if (out.api_error_status) throw new Error(message);
    throw new ModelOutputError(message, { cause: out.result });
  }
  const usage = out.usage ?? {};
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    visualization: out.structured_output ?? JSON.parse(out.result),
    raw: typeof out.result === 'string' ? out.result : JSON.stringify(out.structured_output),
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + cacheRead,
    cachedInputTokens: cacheRead,
    outputTokens: usage.output_tokens ?? null,
    reportedCostUsd: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null,
  };
}

async function runCodex(model: ModelConfig, systemFile: string, prompt: string, tag: string): Promise<GenerationOutput> {
  const schemaFile = path.join(CLI_CWD, `schema-${tag}.json`);
  await writeFile(schemaFile, JSON.stringify(SCHEMA));
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox', 'read-only',
    '-m', model.cliModel ?? model.id,
    '--output-schema', schemaFile,
    '--json',
    '-c', `model_instructions_file=${JSON.stringify(systemFile)}`,
    '-c', 'web_search="disabled"',
    ...(model.effort ? ['-c', `model_reasoning_effort="${model.effort}"`] : []),
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['-c', `features.${f}=false`]),
    '-',
  ];
  const stdout = await run('codex', args, prompt);

  let message: string | null = null;
  let usage: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') message = event.item.text;
    if (event.type === 'turn.completed') usage = event.usage ?? {};
    if (event.type === 'turn.failed' || event.type === 'error') throw new Error(`codex: ${JSON.stringify(event).slice(0, 500)}`);
  }
  if (message == null) throw new Error('codex: no agent message in output');

  let visualization: Visualization;
  try {
    visualization = JSON.parse(message);
  } catch (err) {
    throw new ModelOutputError(`Model returned invalid JSON: ${err}`, { cause: message });
  }
  return {
    visualization,
    raw: message,
    inputTokens: usage.input_tokens ?? null,
    cachedInputTokens: usage.cached_input_tokens ?? null,
    // As in the OpenAI API, output_tokens already includes reasoning_output_tokens.
    outputTokens: usage.output_tokens ?? null,
    reportedCostUsd: null,
  };
}

function run(cmd: string, args: string[], stdin: string): Promise<string> {
  // Strip API keys (e.g. OPENAI_API_KEY from .env.local) so the CLIs use the subscription login.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: CLI_CWD, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${CLI_TIMEOUT_MS / 1000}s`));
    }, CLI_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // claude -p exits non-zero on errors but still prints its JSON result; let the caller inspect it.
      if (code !== 0 && !stdout.trim()) reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1000)}`));
      else resolve(stdout);
    });
    child.stdin.end(stdin);
  });
}
