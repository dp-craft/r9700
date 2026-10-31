import { cpSync } from 'node:fs';

import { type PausePayload } from 'spec-pipeline/protocol';
import { type GoalEntry, type GoalsDoc, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
import { irSet, irValidate } from '../run/ir.js';
import { type Screen } from '../ui/screen.js';
const a: readonly unknown[] = [cpSync, PausePayload, GoalEntry, GoalsDoc, NonGoalEntry, ResolutionIr, irSet, irValidate, Screen];
void a;
