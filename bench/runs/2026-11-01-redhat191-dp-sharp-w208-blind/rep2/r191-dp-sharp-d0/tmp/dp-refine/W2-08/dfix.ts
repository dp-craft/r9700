import { fileURLToPath } from 'node:url';

import { type PausePayload } from 'spec-pipeline/protocol';

import { type GoalsDoc, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { applyResolve, type ResolveConfirmInput, resolveConfirmScreen } from '../../src/screens/resolve-confirm.js';
