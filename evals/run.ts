// Eval runner: for each (model, item) makes the same request the app's /api/chat makes
// (system prompt + JSON schema), renders the code in /sandbox, runs deterministic checks, and
// stores results. Like the app, if the code throws it retries once with the error.
// Models run through Vercel AI Gateway, `claude -p`, or `codex exec` (see models.json).
//
//   pnpm eval                                   # default models × all items
//   pnpm eval --models openai/gpt-6.1-sol,anthropic/claude-sonnet-5.5 --items alg-vertex-form
//   pnpm eval --models all                      # include non-default models
//   pnpm eval --run 2026-10-03T14-22-05Z        # resume / add models to an existing run
//
// Requires `pnpm dev` running (override with --base-url). AI_GATEWAY_API_KEY is only needed for
// gateway models; claude/codex models use the CLIs' subscription logins.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';
import { MANIM_SYSTEM_PROMPT } from '../app/api/shared/systemPrompt';
import { VISUALIZATION_RESPONSE_FORMAT, type ChatRequest } from '../app/api/shared/visualization';
import datasetJson from './dataset.json';
import modelsJson from './models.json';
import { generate as generateWith, ModelOutputError } from './providers';
import { computeChecks, launchBrowser, renderAndAnalyze, scoreChecks, type RenderOutcome } from './sandbox';
import { CHECK_IDS, type Attempt, type Backend, type Dataset, type ItemResult, type ModelConfig, type ModelSummary, type RunMeta } from './types';

// Any OpenAI-compatible endpoint works (e.g. LM Studio for local models).
const GATEWAY_URL = process.env.AI_GATEWAY_URL ?? 'https://ai-gateway.vercel.sh/v1';
const RESULTS_DIR = path.resolve('evals/results');

const dataset = datasetJson as Dataset;
const allModels = modelsJson.models as ModelConfig[];

interface Args {
  models: ModelConfig[];
  items: string[];
  runId: string;
  baseUrl: string;
  concurrency: number;
  cliConcurrency: number;
  renderConcurrency: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

  const modelsArg = get('--models');
  const ids = modelsArg === 'all'
    ? allModels.map((m) => m.id)
    : list(modelsArg).length ? list(modelsArg) : allModels.filter((m) => m.default).map((m) => m.id);
  const models = ids.map((id) => {
    const config = allModels.find((m) => m.id === id);
    if (!config) throw new Error(`Unknown model ${id} — add it to evals/models.json`);
    return config;
  });
  const items = list(get('--items')).length ? list(get('--items')) : dataset.items.map((i) => i.id);

  const unknown = items.filter((id) => !dataset.items.some((i) => i.id === id));
  if (unknown.length) throw new Error(`Unknown item ids: ${unknown.join(', ')}`);

  return {
    models,
    items,
    runId: get('--run') ?? new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z'),
    baseUrl: get('--base-url') ?? process.env.SANDBOX_URL ?? 'http://localhost:3000',
    concurrency: Number(get('--concurrency') ?? 8),
    cliConcurrency: Number(get('--cli-concurrency') ?? 3),
    renderConcurrency: Number(get('--render-concurrency') ?? 3),
  };
}

const modelSlug = (model: string) => model.replace(/\//g, '__');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

type Pricing = Record<string, { input: number; output: number; cacheRead: number | null }>;

async function fetchPricing(): Promise<Pricing> {
  try {
    const res = await fetch(`${GATEWAY_URL}/models`);
    const { data } = (await res.json()) as { data: { id: string; pricing?: { input?: string; output?: string; input_cache_read?: string } }[] };
    return Object.fromEntries(
      data
        .filter((m) => m.pricing?.input && m.pricing?.output)
        .map((m) => [m.id, {
          input: Number(m.pricing!.input),
          output: Number(m.pricing!.output),
          cacheRead: m.pricing!.input_cache_read ? Number(m.pricing!.input_cache_read) : null,
        }]),
    );
  } catch {
    return {};
  }
}

class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private slots: number) {}
  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.slots > 0) this.slots--;
    else await new Promise<void>((resolve) => this.queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.slots++;
    }
  }
}

async function generate(
  gateway: OpenAI | null,
  model: ModelConfig,
  request: ChatRequest,
  pricing: Pricing,
): Promise<{ generation: Attempt['generation']; code: string | null; infraError?: string }> {
  const started = Date.now();
  try {
    const out = await generateWith(model, request, gateway);
    const price = pricing[model.id];
    let costUsd = out.reportedCostUsd;
    if (costUsd == null && price && out.inputTokens != null && out.outputTokens != null) {
      const cached = price.cacheRead != null ? out.cachedInputTokens ?? 0 : 0;
      costUsd = (out.inputTokens - cached) * price.input + cached * (price.cacheRead ?? 0) + out.outputTokens * price.output;
    }
    const { visualization } = out;
    const code = typeof visualization?.manimCode === 'string' && visualization.manimCode.trim() ? visualization.manimCode : null;
    return {
      generation: {
        latencyMs: Date.now() - started,
        inputTokens: out.inputTokens,
        cachedInputTokens: out.cachedInputTokens,
        outputTokens: out.outputTokens,
        costUsd,
        rawResponse: out.raw,
        explanation: typeof visualization?.explanation === 'string' ? visualization.explanation : null,
      },
      code,
    };
  } catch (err) {
    const raw = err instanceof Error && typeof err.cause === 'string' ? err.cause : '';
    const infraError = err instanceof ModelOutputError ? undefined : String(err);
    return {
      infraError,
      generation: {
        latencyMs: Date.now() - started,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        costUsd: null,
        rawResponse: raw,
        explanation: null,
        error: String(err),
      },
      code: null,
    };
  }
}

function summarize(model: ModelConfig, results: ItemResult[]): ModelSummary {
  const n = results.length || 1;
  const finals = results.map((r) => r.attempts[r.attempts.length - 1]);
  const checkPassRates: ModelSummary['checkPassRates'] = {};
  for (const id of CHECK_IDS) {
    // Results from older runs may predate a check.
    const applicable = finals.filter((a) => a.checks[id] && a.checks[id].pass !== null);
    if (applicable.length) checkPassRates[id] = applicable.filter((a) => a.checks[id].pass).length / applicable.length;
  }
  const generations = results.flatMap((r) => r.attempts.map((a) => a.generation));
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  return {
    model: model.id,
    via: model.via,
    items: results.length,
    meanScore: sum(results.map((r) => r.score)) / n,
    firstAttemptMeanScore: sum(results.map((r) => r.firstAttemptScore)) / n,
    retryRate: results.filter((r) => r.retried).length / n,
    fullPassRate: results.filter((r) => r.score === 1).length / n,
    checkPassRates,
    meanLatencyMs: sum(generations.map((g) => g.latencyMs)) / n,
    totalCostUsd: generations.every((g) => g.costUsd == null) ? null : sum(generations.map((g) => g.costUsd ?? 0)),
  };
}

async function loadResults(runDir: string, model: string): Promise<ItemResult[]> {
  const dir = path.join(runDir, modelSlug(model));
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as ItemResult));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  const needsGateway = args.models.filter((m) => m.via === 'gateway');
  if (needsGateway.length && !apiKey) {
    throw new Error(`AI_GATEWAY_API_KEY is not set (add it to .env.local) — needed for ${needsGateway.map((m) => m.id).join(', ')}`);
  }

  try {
    await fetch(`${args.baseUrl}/sandbox`);
  } catch {
    throw new Error(`Sandbox not reachable at ${args.baseUrl} — start it with \`pnpm dev\` or pass --base-url`);
  }

  const runDir = path.join(RESULTS_DIR, args.runId);
  await mkdir(runDir, { recursive: true });
  const metaPath = path.join(runDir, 'run.json');
  const datasetHash = sha(JSON.stringify(dataset.items));
  const promptHash = sha(MANIM_SYSTEM_PROMPT + JSON.stringify(VISUALIZATION_RESPONSE_FORMAT));

  const previous: RunMeta | null = existsSync(metaPath) ? JSON.parse(await readFile(metaPath, 'utf8')) : null;
  if (previous && (previous.datasetHash !== datasetHash || previous.promptHash !== promptHash)) {
    console.warn(`⚠ Run ${args.runId} was started with a different dataset or prompt; results may not be comparable.`);
  }
  const meta: RunMeta = {
    runId: args.runId,
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    datasetVersion: dataset.version,
    datasetHash,
    promptHash,
    models: [...new Set([...(previous?.models ?? []), ...args.models.map((m) => m.id)])],
    itemIds: [...new Set([...(previous?.itemIds ?? []), ...args.items])],
    summaries: previous?.summaries ?? [],
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  const gateway = apiKey ? new OpenAI({ apiKey, baseURL: GATEWAY_URL, timeout: 10 * 60_000, maxRetries: 3 }) : null;
  const pricing = await fetchPricing();
  const browser = await launchBrowser();
  // CLIs share subscription rate limits, so they get a smaller pool each.
  const genSems: Record<Backend, Semaphore> = {
    gateway: new Semaphore(args.concurrency),
    claude: new Semaphore(args.cliConcurrency),
    codex: new Semaphore(args.cliConcurrency),
  };
  const renderSem = new Semaphore(args.renderConcurrency);

  const tasks = args.models.flatMap((model) => args.items.map((itemId) => ({ model, item: dataset.items.find((i) => i.id === itemId)! })));
  const total = tasks.length;
  let done = 0;
  let skipped = 0;
  console.log(`Run ${args.runId}: ${args.models.length} models × ${args.items.length} items → ${runDir}`);
  for (const m of args.models) console.log(`  ${m.id} via ${m.via}${m.effort ? ` (effort ${m.effort})` : ''}`);

  await Promise.all(tasks.map(async ({ model, item }) => {
    const modelDir = path.join(runDir, modelSlug(model.id));
    const resultPath = path.join(modelDir, `${item.id}.json`);
    if (existsSync(resultPath)) {
      done++;
      return;
    }

    const attempts: Attempt[] = [];
    let request: ChatRequest = { messages: [{ role: 'user', content: item.prompt }], currentFrame: null };

    // Same flow as app/page.tsx: one request, and if the code throws, one auto-retry with the error.
    for (const kind of ['initial', 'auto-retry'] as const) {
      const { generation, code, infraError } = await genSems[model.via].use(() => generate(gateway, model, request, pricing));
      if (infraError) {
        // Not the model's fault (auth, credits, rate limit, CLI crash) — leave unsaved so a resume retries it.
        skipped++;
        done++;
        console.error(`[${done}/${total}] ${model.id} / ${item.id}: skipped — ${infraError.slice(0, 200)}`);
        return;
      }

      let render: RenderOutcome | null = null;
      if (code) {
        try {
          render = await renderSem.use(() => renderAndAnalyze(browser, args.baseUrl, code));
        } catch (err) {
          // Harness failure (browser/server), not the model's fault — leave unsaved so a resume retries it.
          console.error(`✗ harness error ${model.id} / ${item.id}: ${err}`);
          skipped++;
          done++;
          return;
        }
      }

      const checks = computeChecks(code, render);
      await mkdir(modelDir, { recursive: true });
      const frames: Attempt['frames'] = {};
      const prefix = `${modelSlug(model.id)}/${item.id}.${attempts.length}`;
      if (render?.finalJpeg) {
        frames.final = `${prefix}.final.jpg`;
        await writeFile(path.join(runDir, frames.final), render.finalJpeg);
      }
      if (render?.interactedJpeg) {
        frames.interacted = `${prefix}.interacted.jpg`;
        await writeFile(path.join(runDir, frames.interacted), render.interactedJpeg);
      }

      attempts.push({
        kind,
        score: scoreChecks(checks),
        checks,
        generation,
        code,
        render: render && {
          durationMs: render.durationMs,
          fatalError: render.fatalError,
          errors: render.errors,
          interactionErrors: render.interactionErrors,
          playCount: render.playCount,
          controls: render.controls,
          draggables: render.draggables,
          clickables: render.clickables,
          hoverables: render.hoverables,
          interactions: render.interactions,
        },
        frames,
      });

      if (!code || !render?.fatalError) break;
      request = { ...request, retryContext: { failedCode: code, error: render.fatalError } };
    }

    const final = attempts[attempts.length - 1];
    const result: ItemResult = {
      itemId: item.id,
      model: model.id,
      via: model.via,
      score: final.score,
      firstAttemptScore: attempts[0].score,
      retried: attempts.length > 1,
      attempts,
      finishedAt: new Date().toISOString(),
    };
    await writeFile(resultPath, JSON.stringify(result, null, 2));

    done++;
    const failed = CHECK_IDS.filter((id) => final.checks[id]?.pass === false);
    const retryNote = result.retried ? ` (after auto-retry, first try ${(result.firstAttemptScore * 100).toFixed(0)}%)` : '';
    const error = final.generation.error ? `  (${final.generation.error.slice(0, 120)})` : '';
    console.log(`[${done}/${total}] ${model.id} / ${item.id}: ${(result.score * 100).toFixed(0)}%${retryNote}${failed.length ? `  ✗ ${failed.join(', ')}` : ''}${error}`);
  }));

  await browser.close();

  const summaries = await Promise.all(meta.models.map(async (id) => {
    const config = allModels.find((m) => m.id === id) ?? { id, via: 'gateway' as const, default: false };
    const results = await loadResults(runDir, id);
    return results.length ? summarize(config, results) : null;
  }));
  meta.summaries = summaries.filter((s): s is ModelSummary => s !== null);
  meta.finishedAt = new Date().toISOString();
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  console.log('\nModel'.padEnd(36) + 'Score   1stTry   AllPass  Retried  Cost      Latency');
  for (const s of [...meta.summaries].sort((a, b) => b.meanScore - a.meanScore)) {
    const pct = (v?: number) => `${((v ?? 0) * 100).toFixed(0)}%`.padEnd(8);
    console.log(
      s.model.padEnd(35) + pct(s.meanScore) + ' ' + pct(s.firstAttemptMeanScore) + ' ' + pct(s.fullPassRate) + ' ' + pct(s.retryRate) + ' ' +
      (s.totalCostUsd == null ? '—' : `$${s.totalCostUsd.toFixed(2)}${s.via === 'gateway' ? '' : '*'}`).padEnd(10) + `${(s.meanLatencyMs / 1000).toFixed(1)}s`,
    );
  }
  if (skipped) {
    console.log(`\n${skipped} item(s) skipped due to API/CLI errors — fix the cause and rerun with --run ${args.runId} to fill them in.`);
  }
  if (meta.summaries.some((s) => s.via !== 'gateway')) {
    console.log('* API-equivalent cost — claude/codex runs are billed to your subscription, not per token.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
