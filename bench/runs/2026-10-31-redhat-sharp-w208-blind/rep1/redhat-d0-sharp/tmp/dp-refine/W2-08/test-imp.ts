import { type PausePayload } from 'spec-pipeline/protocol';
import { type GoalsDoc, type ResolutionIr } from '../../../shared/ir/resolution.js';
import type { ResolveConfirmInput } from '../../src/screens/resolve-confirm.js';
import { applyResolve, resolveConfirmScreen } from '../../src/screens/resolve-confirm.js';
const a: readonly unknown[] = [PausePayload, GoalsDoc, ResolutionIr, ResolveConfirmInput, applyResolve, resolveConfirmScreen];
void a;
