// Debug progress logger: emits terse one-line run events to STDERR only (stdout
// carries the machine-readable AgentRunResult JSON and MUST stay clean).
const PREFIX = '[runner] ';
const DEBUG_FLAG = '--debug';
const DEBUG_ENV = 'RUNNER_DEBUG';
const DEBUG_ON = '1';

export interface Progress {
  readonly event: (stage: string, detail?: string) => void;
}

export const debugEnabled = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): boolean => env[DEBUG_ENV] === DEBUG_ON || argv.includes(DEBUG_FLAG);

const writeStderr = (line: string): void => {
  process.stderr.write(line);
};

const formatLine = (stage: string, detail?: string): string => {
  const suffix = detail !== undefined && detail !== '' ? ` — ${detail}` : '';
  return `${PREFIX}${stage}${suffix}\n`;
};

const noopEvent = (): void => {};

export const createProgress = (
  enabled: boolean,
  write: (line: string) => void = writeStderr
): Progress =>
  enabled ? { event: (stage, detail) => write(formatLine(stage, detail)) } : { event: noopEvent };
