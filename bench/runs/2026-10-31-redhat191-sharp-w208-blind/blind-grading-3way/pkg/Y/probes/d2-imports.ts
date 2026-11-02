// PROBE-ONLY: D2 import lines verbatim (brief lines 49-51). Import-order probe (eslint only;
// the module targets do not exist yet, so no tsc run on this file).
import { type ResolutionIr, type GoalsDoc, type GoalEntry, type NonGoalEntry } from '../../../shared/ir/resolution.js';
import { type PausePayload } from 'spec-pipeline/protocol';
import { type Screen } from '../ui/screen.js';
export const _probe = [ResolutionIr, GoalsDoc, GoalEntry, NonGoalEntry, PausePayload, Screen];
