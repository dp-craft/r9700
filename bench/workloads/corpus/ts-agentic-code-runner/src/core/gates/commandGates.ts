import { resolve } from 'node:path';

import type { Gate, GateContext, GateFailure, GateName, GateRunResult } from './gates';
import { VITEST_BIN } from './gates';

const TEST_SCOPE_ENV = 'RUNNER_TEST_SCOPE';

type CommandGateName = Exclude<GateName, 'decomposition' | 'functional-style' | 'drive'>;

const GATE_COMMANDS: Readonly<Record<CommandGateName, string>> = {
  // lint:check = ESLint report-only (no --fix): the lint gate verifies, it does
  // not mutate the tree as a side effect. (Auto-fix happens at edit/commit time.)
  lint: 'npm run lint:check',
  tsc: 'npx tsc -b',
  test: 'npm test',
};

const toFailure = (gate: GateName, result: GateRunResult): GateFailure => ({
  gate,
  message: `${gate} gate failed with exit code ${result.exitCode}`,
  output: `${result.stdout}\n${result.stderr}`.trim(),
});

const makeGate =
  (gate: CommandGateName): Gate =>
    async (ctx: GateContext): Promise<GateFailure | null> => {
      const result = await ctx.run(GATE_COMMANDS[gate]);
      return result.exitCode === 0 ? null : toFailure(gate, result);
    };

export const lintGate: Gate = makeGate('lint');
export const tscGate: Gate = makeGate('tsc');
export const testGate: Gate = makeGate('test');

const isScopeFull = (): boolean => process.env[TEST_SCOPE_ENV] === 'full';

const runOrFail = async (ctx: GateContext, cmd: string): Promise<GateFailure | null> => {
  const result = await ctx.run(cmd);
  return result.exitCode === 0 ? null : toFailure('test', result);
};

// File-scoped lint gate: lints ONLY the files the run touched, not the whole
// src/** tree — pre-existing unrelated errors must never false-fail a run.
// Autofixes touched files (import-sort, formatting) then fails only on
// non-fixable errors (--fix still exits non-zero when those remain); default
// project config (eslint.config.mjs) applies because generated code lives in src/.
export const scopedLintGate =
  (files: readonly string[]): Gate =>
    async (ctx: GateContext): Promise<GateFailure | null> => {
      if (files.length === 0) {
        return null;
      }
      const args = files.map((f): string => `'${resolve(ctx.cwd, f)}'`).join(' ');
      const result = await ctx.run(`npx eslint --fix ${args}`);
      return result.exitCode === 0 ? null : toFailure('lint', result);
    };

export const scopedTestGate =
  (files: readonly string[]): Gate =>
    async (ctx: GateContext): Promise<GateFailure | null> => {
      if (isScopeFull() || files.length === 0) {
        return runOrFail(ctx, GATE_COMMANDS['test']);
      }
      const args = files.map((f): string => `'${resolve(ctx.cwd, f)}'`).join(' ');
      return runOrFail(ctx, `${VITEST_BIN} related --run ${args}`);
    };
