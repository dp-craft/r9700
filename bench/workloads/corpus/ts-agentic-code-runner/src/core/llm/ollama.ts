import { ENV } from '../shared';
import { parseNumericEnv } from './sampling';

const OLLAMA_NUM_CTX_ENV = ENV.OLLAMA_NUM_CTX;
// 64k context — the largest window that keeps throughput usable on the remote
// 30GB-VRAM host (131072 measured ~0.9 tok/s → idle-timeout hangs; 65536 holds a
// 65k-char file plus several tool-call turns without sliding-window truncation).
export const DEFAULT_OLLAMA_NUM_CTX = 65536;

export const resolveOllamaNumCtx = (env: NodeJS.ProcessEnv = process.env): number =>
  parseNumericEnv(env[OLLAMA_NUM_CTX_ENV]) ?? DEFAULT_OLLAMA_NUM_CTX;

// Deterministic codegen default — overridable via RUNNER_OLLAMA_TEMPERATURE.
export const DEFAULT_OLLAMA_TEMPERATURE = 0.1;

// Mild repetition penalty default — small open models at low temperature can lock
// into a degenerate repeating loop (a runaway that fills the context window). 1.1
// nudges them out without distorting valid codegen. Overridable via
// RUNNER_OLLAMA_REPEAT_PENALTY (wins through the trailing sampling spread).
export const DEFAULT_OLLAMA_REPEAT_PENALTY = 1.1;

const OLLAMA_IDLE_TIMEOUT_ENV = ENV.OLLAMA_IDLE_TIMEOUT_MS;
const DEFAULT_OLLAMA_IDLE_TIMEOUT_MS = 1_200_000;

export const resolveOllamaIdleTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number =>
  parseNumericEnv(env[OLLAMA_IDLE_TIMEOUT_ENV]) ?? DEFAULT_OLLAMA_IDLE_TIMEOUT_MS;

const OLLAMA_THINK_ENV = ENV.OLLAMA_THINK;

export const resolveOllamaThink = (
  env: NodeJS.ProcessEnv = process.env
): boolean | undefined => {
  const raw = env[OLLAMA_THINK_ENV];
  if (raw === undefined || raw.trim() === '') return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
};

const OLLAMA_SAMPLING_ENV_MAP: Readonly<Record<string, string>> = {
  [ENV.OLLAMA_TEMPERATURE]: 'temperature',
  [ENV.OLLAMA_TOP_P]: 'top_p',
  [ENV.OLLAMA_TOP_K]: 'top_k',
  [ENV.OLLAMA_REPEAT_PENALTY]: 'repeat_penalty',
  // num_predict is a per-step generation-token cap (runaway backstop), not a sampling distribution
  [ENV.OLLAMA_NUM_PREDICT]: 'num_predict',
};

export const resolveOllamaSampling = (
  env: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, number>> => {
  const entries = Object.entries(OLLAMA_SAMPLING_ENV_MAP)
    .map(([envKey, bodyKey]): readonly [string, number | undefined] => [
      bodyKey,
      parseNumericEnv(env[envKey]),
    ])
    .filter((e): e is readonly [string, number] => e[1] !== undefined);
  return Object.fromEntries(entries);
};
