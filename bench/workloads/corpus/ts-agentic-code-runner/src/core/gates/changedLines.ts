import { EOL } from 'node:os';
import { resolve } from 'node:path';

import type { GateContext, GateRunResult } from './gates';

// ---------------------------------------------------------------------------
// Changed-line-range helpers: scope structural gates to only the lines that
// actually changed vs HEAD, so pre-existing violations never false-fail a run.
// ---------------------------------------------------------------------------

// Regex for unified-diff hunk headers: @@ -a[,b] +c[,d] @@
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

interface HunkParseResult {
  readonly hunksSeen: boolean;
  readonly lines: readonly number[];
}

const parseHunkRanges = (diffOutput: string): HunkParseResult => {
  const lines = diffOutput.split(EOL);
  const hunksSeen = lines.some((line): boolean => HUNK_RE.test(line));
  const addedLines = lines.flatMap((line): readonly number[] => {
    const m = HUNK_RE.exec(line);
    if (m === null) return [];
    const start = Number(m[1]);
    // When ,count is explicitly 0 (deletion-only or new-file hunk), there are
    // no added lines — return nothing to avoid a phantom line at `start`.
    // When ,count is absent (single-line hunk like +7), default count is 1.
    const count = m[2] !== undefined ? Number(m[2]) : 1;
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => start + i);
  });
  return { hunksSeen, lines: addedLines };
};

const allLines = (fileText: string): readonly number[] =>
  Array.from({ length: fileText.split('\n').length }, (_, i) => i + 1);

// Returns the set of line numbers (1-based) in the current file that changed
// vs HEAD. Injects ctx.run for testability.
// Fallback rules:
//   - exitCode not in {0,1}: infra error → whole file (safe)
//   - exitCode 0 with empty stdout: could be untracked-new OR truly unchanged;
//     use `git ls-files --error-unmatch` to distinguish
//   - exitCode 1 with empty stdout: likely new/untracked → whole file
//   - unparseable diff: whole file
export const changedLineRanges = async (
  file: string,
  ctx: GateContext,
  fileText: string
): Promise<readonly number[]> => {
  const fallback: GateRunResult = { exitCode: 255, stdout: '', stderr: '' };
  // `?? fallback` is NOT dead: a mock GateRunner may resolve to undefined, which
  // .catch() does not intercept (only rejections), so guard the resolved value.
  const rawResult = await Promise.resolve(
    ctx.run(`git diff -U0 HEAD -- '${resolve(ctx.cwd, file)}'`)
  ).catch((): GateRunResult => fallback);
  const result: GateRunResult = rawResult ?? fallback;
  // exitCode 0 = has diff or no diff; exitCode 1 = some git warnings (acceptable)
  // any other exit code = git unavailable or hard error → fall back
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return allLines(fileText);
  }
  // Empty stdout with exit 1 → new/untracked (git warning path) → whole file
  if (result.stdout.trim() === '' && result.exitCode === 1) {
    return allLines(fileText);
  }
  // Empty stdout with exit 0: could be tracked-unchanged OR untracked-new.
  // Use `git ls-files --error-unmatch` to tell them apart:
  //   exit 0 → tracked (file is known to git) → truly unchanged → []
  //   exit non-0 → untracked-new → gate the whole new file
  if (result.stdout.trim() === '') {
    const lsResult = await ctx
      .run(`git ls-files --error-unmatch '${resolve(ctx.cwd, file)}'`)
      .catch((): GateRunResult => ({ exitCode: 1, stdout: '', stderr: '' }));
    return lsResult.exitCode === 0 ? [] : allLines(fileText);
  }
  const { hunksSeen, lines: ranges } = parseHunkRanges(result.stdout);
  // If stdout was non-empty but no hunks parsed → diff was malformed → fall back
  // If hunks were seen but all were deletion-only → no added lines is correct (empty)
  return hunksSeen ? ranges : allLines(fileText);
};
