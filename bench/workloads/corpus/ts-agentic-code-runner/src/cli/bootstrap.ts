import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Tracing/telemetry env is owned exclusively by launch-config.sh — `.env` MUST
// NOT seed it, or a stray dotenv value would silently redirect traces/spans.
const TRACING_KEY_PREFIXES: readonly string[] = ['OTEL_', 'CLAUDE_CODE_', 'LANGFUSE_'];
const RUNNER_TRACING_KEY = 'RUNNER_TRACING';

export const isTracingOwnedKey = (key: string): boolean =>
  key === RUNNER_TRACING_KEY || TRACING_KEY_PREFIXES.some(prefix => key.startsWith(prefix));

export const dotEnvDefaults = (
  parsed: Record<string, string | undefined>,
  current: NodeJS.ProcessEnv
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        current[entry[0]] === undefined &&
        !isTracingOwnedKey(entry[0])
    )
  );

export const loadDotEnvDefaults = (path = '.env'): void => {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  const defaults = dotEnvDefaults(parsed, process.env);
  Object.entries(defaults).forEach(([k, v]) => {
    process.env[k] = v;
  });
};
