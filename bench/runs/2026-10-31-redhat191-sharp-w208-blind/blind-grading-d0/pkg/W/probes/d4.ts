// PROBE-ONLY: D4 code block of briefs/W2-08.md, verbatim (line 89-91); import targets stubbed.
import { cpSync } from 'node:fs'; // verbatim (real)
// Stub for '../run/ir.js' (W2-05 src/run/ir.ts D1):
type IrResult = { ok: true } | { ok: false; file: string; findings: string | undefined; error: string | undefined };
const irSet = (o: { cli: readonly string[]; kind: string; file: string; path: string; value: unknown }): Promise<IrResult> => Promise.resolve({ ok: true });
const irValidate = (o: { cli: readonly string[]; kind: string; file: string }): Promise<IrResult> => Promise.resolve({ ok: true });
// Stub for 'spec-pipeline/protocol' (lands in W2-01) and this row's D2 types:
type GoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type NonGoalEntry = { readonly id: string; readonly text: string; readonly source: string };
type GoalsDoc = { readonly schemaVersion: number; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] };
type ResolveResult = { readonly kind: 'accept' } | { readonly kind: 'edit'; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] } | { readonly kind: 'correction' } | { readonly kind: 'quit' };
type PausePayload = { readonly runId: string; readonly inputs: Readonly<Record<string, string>>; readonly outputs: readonly string[] };

// The D4 block, verbatim (line 91):
export const applyResolve = (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]): Promise<void>;

// Probe scaffolding (uses the stubs so no-unused-vars does not mask the block's own errors):
export const _probe = [cpSync, irSet, irValidate];
