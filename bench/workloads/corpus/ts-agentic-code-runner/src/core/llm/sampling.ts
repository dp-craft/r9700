import { DEFAULT_GENERATE_TIMEOUT_MS } from '../config';
import { ENV } from '../shared';

const GENERATE_TIMEOUT_ENV = ENV.GENERATE_TIMEOUT_MS;
// Re-exported from ./config (single owner). The global timeout governs BOTH the
// per-step AbortController and the HTTP client's idle timeouts — keeping them in
// lock-step is the whole point: Node's built-in fetch (undici) defaults
// headersTimeout/bodyTimeout to 5 min, so a slow-but-progressing step (e.g. a large
// CPU-offloaded prefill) that streams no bytes for >5 min was killed with
// `fetch failed` long before the runner's own timer. Raising the client idle timeout
// to this same value makes the abort timer the sole authority.
export { DEFAULT_GENERATE_TIMEOUT_MS };

const SAMPLING_ENV_MAP: Readonly<Record<string, string>> = {
  [ENV.OPENROUTER_TEMPERATURE]: 'temperature',
  [ENV.OPENROUTER_TOP_P]: 'top_p',
  [ENV.OPENROUTER_TOP_K]: 'top_k',
  [ENV.OPENROUTER_MIN_P]: 'min_p',
  [ENV.OPENROUTER_REPETITION_PENALTY]: 'repetition_penalty',
};

export const parseNumericEnv = (raw: string | undefined): number | undefined => {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export const resolveSampling = (
  env: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, number>> | undefined => {
  const entries = Object.entries(SAMPLING_ENV_MAP)
    .map(([envKey, bodyKey]): readonly [string, number | undefined] => [
      bodyKey,
      parseNumericEnv(env[envKey]),
    ])
    .filter((e): e is readonly [string, number] => e[1] !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

const REASONING_EFFORT_ENV = ENV.OPENROUTER_REASONING_EFFORT;
const REASONING_MAX_TOKENS_ENV = ENV.OPENROUTER_REASONING_MAX_TOKENS;
const REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ReasoningSetting =
  | { readonly enabled: true; readonly effort: ReasoningEffort }
  | { readonly enabled: true; readonly max_tokens: number }
  | { readonly enabled: false; readonly effort: 'none' };

const resolveReasoningEffort = (env: NodeJS.ProcessEnv): ReasoningEffort | undefined => {
  const val = (env[REASONING_EFFORT_ENV] ?? '').trim() as ReasoningEffort;
  return REASONING_EFFORTS.includes(val) ? val : undefined;
};

export const resolveReasoning = (
  env: NodeJS.ProcessEnv = process.env
): ReasoningSetting | undefined => {
  const effort = resolveReasoningEffort(env);
  if (effort === 'none') return { enabled: false, effort: 'none' };
  if (effort !== undefined) return { enabled: true, effort };
  const maxTokens = parseNumericEnv(env[REASONING_MAX_TOKENS_ENV]);
  return maxTokens === undefined ? undefined : { enabled: true, max_tokens: maxTokens };
};

export const resolveGenerateTimeoutMs = (): number => {
  const parsed = Number(process.env[GENERATE_TIMEOUT_ENV] ?? DEFAULT_GENERATE_TIMEOUT_MS);
  return Number.isNaN(parsed) ? DEFAULT_GENERATE_TIMEOUT_MS : parsed;
};

// Total wall-clock backstop (45 min). A non-converging model that keeps emitting
// tokens re-arms the idle-gap watchdog forever — this one-shot cap, armed once at
// drive start and never re-armed, aborts an active-but-non-converging run.
export const DEFAULT_GENERATE_MAX_TOTAL_MS = 2_700_000;

export const resolveGenerateMaxTotalMs = (env: NodeJS.ProcessEnv = process.env): number =>
  parseNumericEnv(env[ENV.GENERATE_MAX_TOTAL_MS]) ?? DEFAULT_GENERATE_MAX_TOTAL_MS;
