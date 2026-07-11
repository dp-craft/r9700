import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  failedOutputFilename,
  parseSpecId,
  parseTaskId,
  preserveFailedOutputs,
  sanitizeModelId
} from './failed-output';

describe('parseSpecId', () => {
  it('should extract leading digits of the feature dir when given a nav bundle path', () => {
    expect(parseSpecId('specs/045-llm-result-evaluation/task-dag/nav/T003.json')).toBe('045');
  });

  it('should fall back to the full feature-dir segment when it has no leading digits', () => {
    expect(parseSpecId('specs/llm-result-evaluation/task-dag/nav/T003.json')).toBe(
      'llm-result-evaluation'
    );
  });

  it('should fall back to unknown when there is no specs segment', () => {
    expect(parseSpecId('foo/bar/baz.json')).toBe('unknown');
  });
});

describe('parseTaskId', () => {
  it('should return the basename without .json when given a nav bundle path', () => {
    expect(parseTaskId('specs/045-llm-result-evaluation/task-dag/nav/T003.json')).toBe('T003');
  });

  it('should fall back to unknown when the path is empty', () => {
    expect(parseTaskId('')).toBe('unknown');
  });

  it('should fall back to unknown when the basename is not a task id', () => {
    expect(parseTaskId('nofile')).toBe('unknown');
  });

  it('should return a short task id like T12', () => {
    expect(parseTaskId('specs/x/nav/T12.json')).toBe('T12');
  });
});

describe('sanitizeModelId', () => {
  it('should take the last slash segment and strip the tag', () => {
    expect(sanitizeModelId('qwen/qwen3.6-35b-a3b:free')).toBe('qwen3.6-35b-a3b');
  });

  it('should replace disallowed characters with a dash', () => {
    expect(sanitizeModelId('vendor/model name@v2')).toBe('model-name-v2');
  });

  it('should return unknown for an empty model id', () => {
    expect(sanitizeModelId('')).toBe('unknown');
  });

  it('should return unknown for the unknown sentinel', () => {
    expect(sanitizeModelId('unknown')).toBe('unknown');
  });
});

describe('failedOutputFilename', () => {
  it('should join the parts with dashes preserving the original basename', () => {
    expect(
      failedOutputFilename('045', 'T003', 1718900000000, 'qwen3.6-35b-a3b', 'usePromptTesterStore.ts')
    ).toBe('045-T003-1718900000000-qwen3.6-35b-a3b-usePromptTesterStore.ts');
  });
});

describe('preserveFailedOutputs', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'failed-output-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should preserve a mutated file under the expected name with the same content', async () => {
    const flatRel = 'foo.ts';
    writeFileSync(path.join(cwd, flatRel), 'failed content');
    const written = await preserveFailedOutputs({
      navBundlePath: 'specs/045-llm-result-evaluation/task-dag/nav/T003.json',
      modelId: 'qwen/qwen3.6-35b-a3b:free',
      mutatedFiles: [flatRel],
      timestamp: 1718900000000,
      cwd,
    });
    const expectedName = '045-T003-1718900000000-qwen3.6-35b-a3b-foo.ts';
    const dest = path.join(cwd, 'logs', 'failed_llm', expectedName);
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('failed content');
    expect(written).toEqual([dest]);
  });

  it('should skip a missing mutated file without throwing', async () => {
    const written = await preserveFailedOutputs({
      navBundlePath: 'specs/045-llm-result-evaluation/task-dag/nav/T003.json',
      modelId: 'qwen/qwen3.6-35b-a3b:free',
      mutatedFiles: ['does-not-exist.ts'],
      timestamp: 1718900000000,
      cwd,
    });
    expect(written).toEqual([]);
  });

  it('should write into a custom destDir when provided', async () => {
    writeFileSync(path.join(cwd, 'bar.ts'), 'data');
    const destDir = path.join(cwd, 'custom');
    const written = await preserveFailedOutputs({
      navBundlePath: 'specs/045-x/task-dag/nav/T009.json',
      modelId: 'unknown',
      mutatedFiles: ['bar.ts'],
      timestamp: 42,
      cwd,
      destDir,
    });
    expect(written).toEqual([path.join(destDir, '045-T009-42-unknown-bar.ts')]);
    expect(existsSync(path.join(destDir, '045-T009-42-unknown-bar.ts'))).toBe(true);
  });
});
