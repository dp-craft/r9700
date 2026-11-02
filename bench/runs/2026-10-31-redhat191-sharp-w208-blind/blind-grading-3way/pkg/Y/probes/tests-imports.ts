// PROBE-ONLY: test-file import lines verbatim (brief lines 102, 132-133), same relative
// order as in the block (one at top, two after the fixture consts). Import-order probe (eslint only).
import { type ResolutionIr, type GoalsDoc } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { resolveConfirmScreen, applyResolve, type ResolveConfirmInput } from '../src/screens/resolve-confirm.js';
export const _probe = [ResolutionIr, GoalsDoc, PausePayload, ResolveConfirmInput, resolveConfirmScreen, applyResolve];
