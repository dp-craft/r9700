import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const lineCount = (text: string): number => text.split('\n').length;

// Resolve a model-supplied path against cwd and assert it cannot escape the
// working dir (path-traversal hardening for read/write/edit).
export const resolveWithinCwd = (cwd: string, p: string): string | null => {
  const resolved = resolve(cwd, p);
  return resolved === cwd || resolved.startsWith(cwd + sep) ? resolved : null;
};

export const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;
export const TESTS_DIR_SEGMENT = `${sep}__tests__${sep}`;

export const isTestFilePath = (resolved: string): boolean =>
  TEST_FILE_RE.test(resolved) || resolved.includes(TESTS_DIR_SEGMENT);

export const isColocatedTestFile = (
  resolved: string,
  resolvedTargets: readonly string[]
): boolean => {
  if (!isTestFilePath(resolved)) {
    return false;
  }
  const dir = dirname(resolved);
  return resolvedTargets.some((t): boolean => {
    const targetDir = dirname(t);
    return dir === targetDir || dir === `${targetDir}${sep}__tests__`;
  });
};

// Footprint guard: distinguishes UNSCOPED (undefined) from SCOPED (array).
//   undefined  → allow any in-cwd write (unscoped run).
//   []         → deny all writes (scoped, no targets matched).
//   non-empty  → allow declared targets + co-located test files only.
export const isAllowedTarget = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  resolved: string
): boolean => {
  if (allowedTargets === undefined) {
    return true;
  }
  if (allowedTargets.length === 0) {
    return false;
  }
  const resolvedTargets = allowedTargets.map((t): string => resolve(cwd, t));
  return resolvedTargets.includes(resolved) || isColocatedTestFile(resolved, resolvedTargets);
};

export const existingLineCount = async (resolved: string): Promise<number | null> => {
  const fileStats = await stat(resolved).catch(() => null);
  if (fileStats === null || !fileStats.isFile()) return null;
  const text = await readFile(resolved, 'utf8').catch(() => null);
  return text === null ? null : lineCount(text);
};
