import { cpSync } from 'node:fs';

import { type PausePayload } from 'spec-pipeline/protocol';

import { irSet, irValidate } from '../run/ir.js';
import { type Screen } from '../ui/screen.js';
import { type GoalEntry, type GoalsDoc, type NonGoalEntry, type ResolutionIr } from '../../../shared/ir/resolution.js';
