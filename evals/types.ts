// Shared shapes for the eval dataset and stored results.
// Results on disk follow these types so the /eval page can read them directly.

export interface DatasetItem {
  id: string;
  category: string;
  grade: number;
  prompt: string;
  tags: string[];
  /** Human-readable expectations. Not scored yet — reserved for a future LLM judge. */
  checklist: string[];
}

export interface Dataset {
  version: number;
  description: string;
  tagLegend: Record<string, string>;
  items: DatasetItem[];
}

export type Backend = 'gateway' | 'claude' | 'codex';

export interface ModelConfig {
  /** Gateway-style ID used to name results, e.g. "anthropic/claude-sonnet-5.5". */
  id: string;
  /** gateway = Vercel AI Gateway API; claude / codex = headless CLI on your subscription. */
  via: Backend;
  /** Model name the CLI expects, e.g. "claude-sonnet-5-5" or "gpt-6.1-sol". */
  cliModel?: string;
  /** Reasoning effort passed to the CLI. Unset = the CLI's default. */
  effort?: string;
  /** Run when --models is omitted. */
  default: boolean;
  note?: string;
}

export const CHECK_IDS = [
  'generated',
  'runs',
  'completes',
  'nonBlank',
  'inFrame',
  'noTextOverlap',
  'noRawLatex',
  'interactive',
  'respondsToInteraction',
  'canvasInteraction',
  'stableUnderInteraction',
] as const;

export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_DESCRIPTIONS: Record<CheckId, string> = {
  generated: 'Returns valid JSON with manimCode (same structured output as the app)',
  runs: 'No runtime errors while the scene builds and settles',
  completes: 'Reaches the final scene.wait() within 45s',
  nonBlank: 'Something is actually drawn on the canvas',
  inFrame: 'No mobject extends past the visible 16:9 frame',
  noTextOverlap: 'Labels do not overlap each other or hide under the controls panel',
  noRawLatex: 'No LaTeX source shown in plain Text (should be MathTex)',
  interactive: 'Has at least one slider, button, draggable, clickable, or hoverable',
  respondsToInteraction: 'Every slider, checkbox, draggable, clickable and hoverable visibly changes the canvas when used',
  canvasInteraction: 'The scene itself responds to the pointer: at least one draggable or clickable mobject visibly changes the canvas (not only panel controls)',
  stableUnderInteraction: 'No new errors after interacting',
};

/** If any of these fail, the item scores 0. */
export const CRITICAL_CHECKS: CheckId[] = ['generated', 'runs', 'completes', 'nonBlank'];

export interface CheckResult {
  /** null = not applicable (e.g. no sliders/draggables to interact with). */
  pass: boolean | null;
  detail?: string;
}

export type InteractionKind = 'slider' | 'checkbox' | 'button' | 'hover' | 'click' | 'drag';

/** One control exercised by the harness, measured on its own. */
export interface InteractionResult {
  kind: InteractionKind;
  label: string;
  /** Fraction of canvas pixels that changed (controls panel masked out). */
  change: number;
  responded: boolean;
}

export interface Attempt {
  /** The app auto-retries once (with the error + failed code) when the generated code throws. */
  kind: 'initial' | 'auto-retry';
  /** 0..1 — 0 if a critical check fails, otherwise the fraction of applicable checks passed. */
  score: number;
  checks: Record<CheckId, CheckResult>;
  generation: {
    latencyMs: number;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    /**
     * Gateway: estimated from list prices. claude: API-equivalent cost reported by the CLI.
     * codex: estimated from gateway list prices. CLI runs are not actually billed per token.
     */
    costUsd: number | null;
    /** Raw JSON response from the model. */
    rawResponse: string;
    explanation: string | null;
    error?: string;
  };
  code: string | null;
  render: {
    durationMs: number;
    fatalError: string | null;
    errors: string[];
    interactionErrors: string[];
    playCount: number;
    controls: { sliders: number; buttons: number; checkboxes: number };
    draggables: number;
    clickables: number;
    hoverables: number;
    /** Absent in runs made before per-interaction measurement. */
    interactions?: InteractionResult[];
  } | null;
  /** Paths relative to the run directory. */
  frames: { final?: string; interacted?: string };
}

export interface ItemResult {
  itemId: string;
  model: string;
  via: Backend;
  /** Score of what the user ends up seeing — the last attempt. */
  score: number;
  firstAttemptScore: number;
  retried: boolean;
  attempts: Attempt[];
  finishedAt: string;
}

export interface ModelSummary {
  model: string;
  via: Backend;
  items: number;
  meanScore: number;
  /** Mean score before the app's auto-retry. */
  firstAttemptMeanScore: number;
  /** Fraction of items where the first attempt threw and the app retried. */
  retryRate: number;
  /** Fraction of items where every applicable check passed (final attempt). */
  fullPassRate: number;
  /** Per-check pass rates on the final attempt. */
  checkPassRates: Partial<Record<CheckId, number>>;
  /** Generation latency per item, including the retry. */
  meanLatencyMs: number;
  /** Includes retries. For CLI backends this is the API-equivalent cost, not what was billed. */
  totalCostUsd: number | null;
}

export interface RunMeta {
  runId: string;
  startedAt: string;
  finishedAt?: string;
  datasetVersion: number;
  /** Hashes let the /eval page warn when comparing runs made with a different dataset or prompt. */
  datasetHash: string;
  promptHash: string;
  models: string[];
  itemIds: string[];
  summaries: ModelSummary[];
}
