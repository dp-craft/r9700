import { describe, expect, it } from 'vitest';

import type { ModelEntry, PromptEntry } from '../types';
import { axisLabel, modelAxisMap, nextAxisId, promptAxisMap } from './cellAxisIds';

type AxisEntry = { readonly id: string; readonly axisId?: number };

const makeModel = (id: string, axisId?: number): ModelEntry => ({
  id,
  providerId: 'p',
  modelKey: 'k',
  name: 'n',
  params: { temp: 0, topP: 0, maxTok: 0, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: false,
  accent: false,
  ...(axisId === undefined ? {} : { axisId }),
});

const makePrompt = (id: string, axisId?: number): PromptEntry => ({
  id,
  kind: 'custom',
  text: 't',
  edited: false,
  ...(axisId === undefined ? {} : { axisId }),
});

describe('nextAxisId', () => {
  it('should return 1 when the entry list is empty', () => {
    const entries: readonly AxisEntry[] = [];

    expect(nextAxisId(entries)).toBe(1);
  });

  it('should return 1 when no entry has an axisId', () => {
    const entries: readonly AxisEntry[] = [{ id: 'a' }, { id: 'b' }];

    expect(nextAxisId(entries)).toBe(1);
  });

  it('should return max axisId plus one when all entries have an axisId', () => {
    const entries: readonly AxisEntry[] = [
      { id: 'a', axisId: 1 },
      { id: 'b', axisId: 2 },
      { id: 'c', axisId: 3 },
    ];

    expect(nextAxisId(entries)).toBe(4);
  });

  it('should stay max plus one when a middle entry was deleted leaving a gap', () => {
    const entries: readonly AxisEntry[] = [
      { id: 'a', axisId: 1 },
      { id: 'c', axisId: 3 },
    ];

    expect(nextAxisId(entries)).toBe(4);
  });

  it('should ignore entries lacking an axisId when computing the max', () => {
    const entries: readonly AxisEntry[] = [{ id: 'a', axisId: 5 }, { id: 'b' }];

    expect(nextAxisId(entries)).toBe(6);
  });
});

describe('axisLabel', () => {
  it('should format the model prefix with the axis id', () => {
    expect(axisLabel('M', 3)).toBe('M3');
  });

  it('should format the system prefix with the axis id', () => {
    expect(axisLabel('S', 1)).toBe('S1');
  });
});

describe('modelAxisMap', () => {
  it('should return an empty record for an empty model list', () => {
    expect(modelAxisMap([])).toEqual({});
  });

  it('should label models by their axisId when present', () => {
    const models = [makeModel('a', 2), makeModel('b', 5)];

    expect(modelAxisMap(models)).toEqual({ a: 'M2', b: 'M5' });
  });

  it('should derive a one-based label by index for legacy models lacking an axisId', () => {
    const models = [makeModel('a'), makeModel('b'), makeModel('c')];

    expect(modelAxisMap(models)).toEqual({ a: 'M1', b: 'M2', c: 'M3' });
  });

  it('should mix axisId labels with index fallbacks', () => {
    const models = [makeModel('a', 7), makeModel('b')];

    expect(modelAxisMap(models)).toEqual({ a: 'M7', b: 'M2' });
  });
});

describe('promptAxisMap', () => {
  it('should return an empty record for an empty prompt list', () => {
    expect(promptAxisMap([])).toEqual({});
  });

  it('should label prompts by their axisId when present', () => {
    const prompts = [makePrompt('a', 1), makePrompt('b', 4)];

    expect(promptAxisMap(prompts)).toEqual({ a: 'S1', b: 'S4' });
  });

  it('should derive a one-based label by index for legacy prompts lacking an axisId', () => {
    const prompts = [makePrompt('a'), makePrompt('b')];

    expect(promptAxisMap(prompts)).toEqual({ a: 'S1', b: 'S2' });
  });
});
