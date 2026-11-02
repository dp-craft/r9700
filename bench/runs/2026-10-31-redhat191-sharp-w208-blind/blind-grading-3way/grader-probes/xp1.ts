import { cpSync } from 'node:fs';

import { type PausePayload } from 'spec-pipeline/protocol';
import { type GoalsDoc, type GoalEntry, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { type Screen } from '../ui/screen.js';
import { irSet, irValidate } from '../run/ir.js';
export type Z = [typeof cpSync, PausePayload, GoalsDoc, GoalEntry, NonGoalEntry, ResolutionIr, Screen<1,2>, typeof irSet, typeof irValidate];
