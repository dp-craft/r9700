// PROBE-ONLY header: brief W2-08 D4 block (lines 88-91); the two brief imports (node:fs,
// '../run/ir.js') keep their brief order (node: group precedes the relative group); the
// PROBE-ONLY type imports are ordered per the sort rule so the probe isolates the max-params signal.
import { cpSync } from 'node:fs';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type GoalsDoc } from '../../../shared/ir/resolution.js';
import { irSet, irValidate } from '../run/ir.js';
type ResolveResult = { readonly kind: 'accept' } | { readonly kind: 'edit' } | { readonly kind: 'correction' } | { readonly kind: 'quit' };
export const applyResolve: (result: ResolveResult, record: PausePayload, originalGoals: GoalsDoc, cli: readonly string[]) => Promise<void> =
  (result, record, originalGoals, cli): Promise<void> => Promise.resolve().then(() => { throw new Error('PROBE-ONLY: ' + String(result) + String(record) + String(originalGoals) + String(cli)); });
export const probeRefs = [cpSync, irSet, irValidate];
