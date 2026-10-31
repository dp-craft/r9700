import { cpSync } from 'node:fs';
import { irSet, irValidate } from '../run/ir.js';

export const y = [cpSync, irSet, irValidate];
