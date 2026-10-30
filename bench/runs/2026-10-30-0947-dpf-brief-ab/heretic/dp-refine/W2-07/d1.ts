import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RunPaths } from './paths.js';

export const writeRequest = (paths: RunPaths, text: string): void => {
  mkdirSync(path.dirname(paths.request), { recursive: true });
  writeFileSync(paths.request, text);
};

export const readRequest = (paths: RunPaths): string => readFileSync(paths.request, 'utf8');
