export const VITEST_BIN = './node_modules/.bin/vitest';

export type GateName = 'lint' | 'tsc' | 'test' | 'decomposition' | 'functional-style' | 'drive';

export interface GateRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GateRunner = (cmd: string) => Promise<GateRunResult>;

export interface GateContext {
  readonly cwd: string;
  readonly run: GateRunner;
}

export interface GateFailure {
  readonly gate: GateName;
  readonly message: string;
  readonly output: string;
}

export type Gate = (ctx: GateContext) => Promise<GateFailure | null>;

// Re-export shims: gate implementations live in cohesive sibling files; the
// public surface (and test imports) resolve through this assembly module.
export { changedLineRanges } from './changedLines';
export { lintGate, scopedLintGate, scopedTestGate, testGate, tscGate } from './commandGates';
export {
  complexityFailure,
  complexitySourceFiles,
  decompositionGate,
  resolveMaxComplexity
} from './decompositionGate';
export type { FpViolation } from './fpGate';
export { fpViolations, functionalStyleGate } from './fpGate';

export function runGates(gates: readonly Gate[], ctx: GateContext): Promise<GateFailure | null> {
  return gates.reduce<Promise<GateFailure | null>>(
    (acc, gate) =>
      acc.then((failure: GateFailure | null) => (failure !== null ? failure : gate(ctx))),
    Promise.resolve(null)
  );
}
