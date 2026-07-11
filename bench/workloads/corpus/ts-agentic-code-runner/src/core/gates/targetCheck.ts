import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CleanVerdict {
  readonly clean: boolean;
}

// Injectable git seam: runs an argv, mapping the process exit code. A thrown
// spawn error (binary missing / unspawnable) → exitCode 128 (UNVERIFIABLE, not
// a dirty verdict) so the guard never blocks in a non-git context.
type GitRun = (argv: string[]) => Promise<{ readonly exitCode: number }>;

const GIT_UNVERIFIABLE_EXIT = 128;

const defaultGitRun: GitRun = (argv): Promise<{ exitCode: number }> =>
  execFileAsync('git', argv, { cwd: process.cwd() }).then(
    (): { exitCode: number } => ({ exitCode: 0 }),
    (error: unknown): { exitCode: number } => {
      const code = (error as { code?: number }).code;
      return { exitCode: typeof code === 'number' ? code : GIT_UNVERIFIABLE_EXIT };
    }
  );

// Verdict over the target files: exit 0 → clean, exit 1 → dirty, ANY other exit
// (128 = not a git repo / no HEAD, spawn failure) → UNVERIFIABLE → clean. The
// guard fires ONLY on a definite dirty verdict. Empty targets → clean.
export const checkTargetsClean = async (
  targetFiles: readonly string[],
  run: GitRun = defaultGitRun
): Promise<CleanVerdict> => {
  if (targetFiles.length === 0) {
    return { clean: true };
  }
  const { exitCode } = await run(['diff', '--quiet', 'HEAD', '--', ...targetFiles]);
  return { clean: exitCode !== 1 };
};
