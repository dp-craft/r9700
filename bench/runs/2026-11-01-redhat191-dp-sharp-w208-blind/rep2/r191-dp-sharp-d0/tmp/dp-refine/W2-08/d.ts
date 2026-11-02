import { fileURLToPath } from 'node:url';

import { type PausePayload } from 'spec-pipeline/protocol';

import { type ResolveConfirmInput, applyResolve, resolveConfirmScreen } from '../../src/screens/resolve-confirm.js';
import { type GoalsDoc, type ResolutionIr } from '../../../shared/ir/resolution.js';
