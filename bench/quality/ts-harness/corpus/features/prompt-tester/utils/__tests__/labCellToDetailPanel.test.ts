import { describe, expect, it } from 'vitest';

import type { CellResult, ModelEntry, SliderValues } from '../../types';
import { labCellToDetailPanelProps } from '../labCellToDetailPanel';

const defaultParams: SliderValues = {
  temp: 0.7,
  topP: 1,
  maxTok: 1024,
  freq: 0,
  pres: 0,
};

const buildCell = (overrides: Partial<CellResult> = {}): CellResult => ({
  id: 'cell-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'hash-1',
  output: 'Hello world',
  latencyMs: 1234,
  tokens: 42,
  cost: 0,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

const buildModel = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'model-1',
  providerId: 'openai',
  modelKey: 'gpt-4o-mini',
  name: 'GPT-4o mini',
  params: defaultParams,
  thinking: false,
  supportsThinking: false,
  expanded: false,
  accent: false,
  ...overrides,
});

describe('labCellToDetailPanelProps', () => {
  it('should map happy-path cell to populated output', () => {
    const cell = buildCell({ status: 'done', output: 'Hi there', latencyMs: 500, tokens: 10 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: 'You are helpful.',
      userPrompt: 'Say hi',
    });

    expect(result.cellKey).toBe('cell-1');
    expect(result.responseText).toBe('Hi there');
    expect(result.status).toBe('completed');
    expect(result.error).toBeNull();
    expect(result.systemPrompt).toBe('You are helpful.');
    expect(result.tier1).not.toBeNull();
    expect(result.tier1?.responseTimeMs).toBe(500);
  });

  it('should map error-state cell with empty response and error message', () => {
    const cell = buildCell({ status: 'error', output: 'partial', error: 'boom' });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: 'sys',
      userPrompt: 'u',
    });

    expect(result.responseText).toBe('');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.tier1).toBeNull();
  });

  it('should default systemPrompt to null when input.systemPrompt is undefined', () => {
    const result = labCellToDetailPanelProps({
      cell: buildCell(),
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.systemPrompt).toBeNull();
  });

  it('should NOT mutate the input cell', () => {
    const cell = Object.freeze(buildCell());
    expect(() =>
      labCellToDetailPanelProps({
        cell,
        model: buildModel(),
        systemPrompt: 'sys',
        userPrompt: 'u',
      })
    ).not.toThrow();
  });

  it('should compute tier1.charCount + tier1.wordCount from cell.output', () => {
    const cell = buildCell({ status: 'done', output: 'Hello world foo', latencyMs: 100 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.tier1?.charCount).toBe(15);
    expect(result.tier1?.wordCount).toBe(3);
  });

  it('should map idle status to pending and null tier1', () => {
    const cell = buildCell({ status: 'idle', output: '', latencyMs: 0 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.status).toBe('pending');
    expect(result.tier1).toBeNull();
  });

  // T007: real metrics from cell.ttfMs / cell.tps

  it('should report real timeToFirstTokenMs via top-level field when ttfMs is present', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 1000, ttfMs: 250 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.timeToFirstTokenMs).toBe(250);
  });

  it('should also set tier1.timeToFirstTokenMs to the real value when ttfMs is present', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 1000, ttfMs: 250 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.tier1?.timeToFirstTokenMs).toBe(250);
  });

  it('should surface tps in the output when tps is present', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 1000, tps: 42.5 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.tps).toBe(42.5);
  });

  it('should degrade gracefully when ttfMs is undefined — top-level timeToFirstTokenMs must be null', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 500 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.timeToFirstTokenMs).toBeNull();
  });

  it('should degrade gracefully when tps is undefined — output.tps must be null', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 500 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.tps).toBeNull();
  });

  // T015: runAnalysis VM wiring

  it('should build a populated runAnalysis VM for a completed cell with output', () => {
    const cell = buildCell({ status: 'done', output: 'Hello world foo bar', latencyMs: 100 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.runAnalysis).not.toBeNull();
    expect(typeof result.runAnalysis?.wordCount).toBe('number');
    expect(typeof result.runAnalysis?.perplexity).toBe('number');
  });

  it('should set runAnalysis to null for an error cell', () => {
    const cell = buildCell({ status: 'error', output: 'partial', error: 'boom' });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.runAnalysis).toBeNull();
  });

  it('should set runAnalysis to null for an idle cell', () => {
    const cell = buildCell({ status: 'idle', output: '', latencyMs: 0 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel(),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.runAnalysis).toBeNull();
  });

  it('should consume the model param and include modelName in output', () => {
    const cell = buildCell({ status: 'done', output: 'Hi', latencyMs: 200 });
    const result = labCellToDetailPanelProps({
      cell,
      model: buildModel({ name: 'Claude Opus' }),
      systemPrompt: undefined,
      userPrompt: 'u',
    });

    expect(result.modelName).toBe('Claude Opus');
  });
});
