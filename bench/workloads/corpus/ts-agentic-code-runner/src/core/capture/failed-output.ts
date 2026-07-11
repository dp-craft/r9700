import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UNKNOWN = 'unknown';
const DISALLOWED_CHAR_RE = /[^A-Za-z0-9._-]/g;

// The feature dir is the segment after `specs/`; the specId is its leading
// digits. Falls back to the full feature-dir segment, else 'unknown'.
export const parseSpecId = (navBundlePath: string): string => {
  const segments = navBundlePath.split('/');
  const specsIndex = segments.indexOf('specs');
  const featureDir = specsIndex >= 0 ? segments[specsIndex + 1] : undefined;
  if (featureDir === undefined || featureDir === '') {
    return UNKNOWN;
  }
  const leadingDigits = featureDir.match(/^\d+/);
  return leadingDigits === null ? featureDir : leadingDigits[0];
};

const TASK_ID_RE = /^T\d+$/;

// The task id is the basename without `.json`, but only when it matches the
// `T<digits>` shape; any other basename falls back to 'unknown'.
export const parseTaskId = (navBundlePath: string): string => {
  const base = path.basename(navBundlePath, '.json');
  return TASK_ID_RE.test(base) ? base : UNKNOWN;
};

// Last `/`-segment, tag (`:...`) stripped, remaining disallowed chars dashed.
export const sanitizeModelId = (modelId: string): string => {
  if (modelId === '' || modelId === UNKNOWN) {
    return UNKNOWN;
  }
  const lastSegment = modelId.split('/').at(-1) ?? modelId;
  const withoutTag = lastSegment.split(':')[0];
  const sanitized = withoutTag.replace(DISALLOWED_CHAR_RE, '-');
  return sanitized === '' ? UNKNOWN : sanitized;
};

export const failedOutputFilename = (
  specId: string,
  taskId: string,
  timestamp: number,
  model: string,
  originalBasename: string
): string => `${specId}-${taskId}-${timestamp}-${model}-${originalBasename}`;

export interface PreserveFailedOutputsParams {
  readonly navBundlePath: string;
  readonly modelId: string;
  readonly mutatedFiles: readonly string[];
  readonly timestamp: number;
  readonly cwd?: string;
  readonly destDir?: string;
}

// Best-effort copy of one failed file into destDir. A read/write error resolves
// to null (skip), never throws — preservation must never break revert/return.
interface PreserveOneContext {
  readonly cwd: string;
  readonly destDir: string;
  readonly specId: string;
  readonly taskId: string;
  readonly timestamp: number;
  readonly model: string;
}

const preserveOne = async (file: string, ctx: PreserveOneContext): Promise<string | null> => {
  try {
    const content = await readFile(path.resolve(ctx.cwd, file), 'utf8');
    const name = failedOutputFilename(
      ctx.specId,
      ctx.taskId,
      ctx.timestamp,
      ctx.model,
      path.basename(file)
    );
    const dest = path.join(ctx.destDir, name);
    await writeFile(dest, content);
    return dest;
  } catch {
    return null;
  }
};

// Side-effect boundary: snapshot the failed model output to destDir before the
// revert discards it. Fully best-effort — a per-file or mkdir failure resolves
// to a (possibly empty) list, never throws.
export const preserveFailedOutputs = async (
  params: PreserveFailedOutputsParams
): Promise<readonly string[]> => {
  const cwd = params.cwd ?? process.cwd();
  const destDir = params.destDir ?? path.join(cwd, 'logs', 'failed_llm');
  try {
    await mkdir(destDir, { recursive: true });
  } catch {
    return [];
  }
  const ctx: PreserveOneContext = {
    cwd,
    destDir,
    specId: parseSpecId(params.navBundlePath),
    taskId: parseTaskId(params.navBundlePath),
    timestamp: params.timestamp,
    model: sanitizeModelId(params.modelId),
  };
  const results = await Promise.all(
    params.mutatedFiles.map((file): Promise<string | null> => preserveOne(file, ctx))
  );
  return results.filter((dest): dest is string => dest !== null);
};
