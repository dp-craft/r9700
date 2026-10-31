import { cpSync } from 'node:fs';
import { type PausePayload } from 'spec-pipeline/protocol';
const a: readonly unknown[] = [cpSync, PausePayload];
void a;
