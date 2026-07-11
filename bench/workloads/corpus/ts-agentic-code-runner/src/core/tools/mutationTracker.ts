import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { promisify } from 'node:util';

export const execFileAsync = promisify(execFile);

// Honest file-mutation tracking. A path is recorded only AFTER a mutating tool
// actually writes it — the handler reads the pre-mutation snapshot (content
// string, or null when the path did not exist) and calls `record` once the
// write succeeds, so a no-op (e.g. an edit whose anchor never matched) never
// enters touchedFiles and never triggers a no-op revert.
export interface MutationTracker {
  readonly record: (resolvedPath: string, original: string | null) => void;
  readonly mutatedPaths: () => readonly string[];
  readonly revert: () => Promise<void>;
}

// Read a path's current content, or null when it does not yet exist. Callers
// snapshot this BEFORE mutating so revert can restore (or delete) the path.
export const snapshotOriginal = (resolvedPath: string): Promise<string | null> =>
  readFile(resolvedPath, 'utf8').catch((): null => null);

// Best-effort per-path revert: a recorded null snapshot ⇒ the path was newly
// created ⇒ delete it; a string snapshot ⇒ restore it. fs errors are swallowed.
const revertOne = async (path: string, original: string | null): Promise<void> => {
  const action = original === null ? rm(path, { force: true }) : writeFile(path, original, 'utf8');
  await action.catch((): void => undefined);
};

// Instrumentation boundary (closure over a local mutable Map, matching the
// runner.ts accumulator pattern — no class). Insertion order = first-seen order.
export function createMutationTracker(cwd: string): MutationTracker {
  const originals = new Map<string, string | null>();
  const record = (resolvedPath: string, original: string | null): void => {
    if (!originals.has(resolvedPath)) {
      originals.set(resolvedPath, original);
    }
  };
  const mutatedPaths = (): readonly string[] =>
    [...originals.keys()].map((p): string => relative(cwd, p));
  const revert = async (): Promise<void> => {
    await Promise.all([...originals.entries()].map(([p, o]): Promise<void> => revertOne(p, o)));
  };
  return { record, mutatedPaths, revert };
}
