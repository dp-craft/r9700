import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Gate, GateContext, GateFailure, GateRunResult } from './gates';
import { VITEST_BIN } from './gates';

// Minimal structural view of the task spec this module needs (only the scoped
// target files). Avoids a gates→execution layer edge; TaskSpec is assignable.
interface TestRunTarget {
  readonly targetFiles: readonly string[];
}

const execFileAsync = promisify(execFile);

// A spawn/infra failure (missing/unspawnable binary) carries a string errno in
// `code` (ENOENT/EACCES/…) OR an undefined code with no captured stdio — the
// vitest process never ran, so no test verdict exists. A genuine test failure
// carries a NUMERIC non-zero `code` plus captured stdout/stderr.
const isSpawnFailure = (e: {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}): boolean => {
  if (typeof e.code === 'string') {
    return true;
  }
  return e.code === undefined && !e.stdout && !e.stderr;
};

// Default real test runner: shells out to vitest for the task's target files,
// capturing combined stdout/stderr so failure output is preserved (F-02). A
// numeric non-zero exit ⇒ test failure ({ passed:false }); a spawn errno
// (ENOENT/…) ⇒ THROW so it surfaces as a fatal infra error, not a burned rung.
const NO_TEST_FILES_RE = /No test files found/i;

export const defaultRunTests = (
  spec: TestRunTarget
): (() => Promise<{ passed: boolean; output: string; noTests: boolean }>) => {
  return async (): Promise<{ passed: boolean; output: string; noTests: boolean }> => {
    const vitestArgs =
      process.env.RUNNER_TEST_SCOPE === 'full'
        ? ['run', ...spec.targetFiles]
        : ['related', '--run', ...spec.targetFiles];
    try {
      const { stdout, stderr } = await execFileAsync(VITEST_BIN, vitestArgs);
      const output = `${stdout}\n${stderr}`.trim();
      return { passed: true, output, noTests: NO_TEST_FILES_RE.test(output) };
    } catch (error) {
      const e = error as { code?: number | string; stdout?: string; stderr?: string };
      if (isSpawnFailure(e)) {
        throw new Error(`runner: test command failed to spawn (${e.code}): ${VITEST_BIN}`);
      }
      return { passed: false, output: `${e.stdout ?? ''}\n${e.stderr ?? String(error)}`.trim(), noTests: false };
    }
  };
};

// Gate command runner: shells out via execFile, mapping exit code + stdio.
export const gateRun = (cmd: string): Promise<GateRunResult> =>
  execFileAsync(cmd, { shell: true }).then(
    ({ stdout, stderr }): GateRunResult => ({ exitCode: 0, stdout, stderr }),
    (error: unknown): GateRunResult => {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(error),
      };
    }
  );

export const toGate = (gate: Gate): ((ctx: GateContext) => ReturnType<Gate>) => gate;

// A no-op structural gate: always passes (resolves null). UI tasks substitute
// this for decomposition/functional-style so JSX/hooks are not FP-gated.
export const noopGate = (): Promise<GateFailure | null> => Promise.resolve(null);
