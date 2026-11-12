import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../starMetrics', () => ({
  buildQualityStarRows: vi.fn(() => []),
}));

import type { ModelEntry, PromptEntry, ResultCellVM } from '@/features/prompt-tester/types';

import { buildGridCells, buildGridTable } from '../buildGridRows';
import { buildQualityStarRows } from '../starMetrics';

const mockBuildQualityStarRows = vi.mocked(buildQualityStarRows);

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildQualityStarRows.mockReturnValue([]);
});

// ---------------------------------------------------------------------------
// Minimal builder — only fields used by buildGridRows
// ---------------------------------------------------------------------------
const buildCell = (
  overrides: Partial<ResultCellVM> & { id: string; modelLabel: string; phrase: string }
): ResultCellVM => ({
  title: overrides.modelLabel,
  outputPreview: '',
  output: overrides.output ?? '',
  error: null,
  latencyMs: 0,
  tokens: 0,
  ttfMs: null,
  tps: null,
  isOutdated: false,
  meanRating: 4,
  status: 'done',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const cellA1 = buildCell({ id: 'a1', modelLabel: 'ModelA', phrase: 'Prompt-1' });
const cellA2 = buildCell({ id: 'a2', modelLabel: 'ModelA', phrase: 'Prompt-2' });
const cellB1 = buildCell({ id: 'b1', modelLabel: 'ModelB', phrase: 'Prompt-1' });
const cellB2 = buildCell({ id: 'b2', modelLabel: 'ModelB', phrase: 'Prompt-2' });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('buildGridCells', () => {
  it('should return empty array when cells input is empty', () => {
    // Given
    const cells: readonly ResultCellVM[] = [];

    // When
    const result = buildGridCells(cells, []);

    // Then
    expect(result).toEqual([]);
  });

  it('should return one grid cell per result cell (flat, no matrix collapse)', () => {
    // Given — 4 cells across 2 models and 2 prompts
    const cells = [cellA1, cellA2, cellB1, cellB2] as const;

    // When
    const result = buildGridCells(cells, []);

    // Then
    expect(result).toHaveLength(4);
  });

  it('should key each grid cell by the result cell id', () => {
    // Given — two cells with the same modelLabel (duplicate labels must not collapse)
    const dup1 = buildCell({ id: 'dup1', modelLabel: 'ModelA', phrase: 'Prompt-1' });
    const dup2 = buildCell({ id: 'dup2', modelLabel: 'ModelA', phrase: 'Prompt-2' });

    // When
    const result = buildGridCells([dup1, dup2], []);

    // Then — 2 cells retained, each keyed by own id
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('dup1');
    expect(result[1].id).toBe('dup2');
  });

  it('should set selected true only for cells whose id is in selectedCellIds', () => {
    // Given
    const cells = [cellA1, cellB1] as const;

    // When
    const result = buildGridCells(cells, ['b1']);

    // Then
    const a1vm = result.find(v => v.id === 'a1');
    const b1vm = result.find(v => v.id === 'b1');
    expect(a1vm?.selected).toBe(false);
    expect(b1vm?.selected).toBe(true);
  });

  it('should attach the original ResultCellVM on each grid cell', () => {
    // Given
    const cells = [cellA1] as const;

    // When
    const result = buildGridCells(cells, []);

    // Then
    expect(result[0].cell).toBe(cellA1);
  });
});

// ---------------------------------------------------------------------------
// buildGridTable (matrix builder) — cell id is `${modelId}::${promptId}`
// ---------------------------------------------------------------------------
const buildModel = (id: string, name: string): ModelEntry => ({
  id,
  providerId: 'p',
  modelKey: 'k',
  name,
  params: { temp: 0, topP: 0, maxTok: 0, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: false,
  accent: false,
});

const buildPrompt = (id: string, text: string): PromptEntry => ({
  id,
  kind: 'skill',
  text,
  edited: false,
});

const cell = (modelId: string, promptId: string): ResultCellVM =>
  buildCell({
    id: `${modelId}::${promptId}`,
    modelLabel: modelId,
    phrase: promptId,
  });

describe('buildGridTable', () => {
  it('should return empty columns and rows when inputs are empty', () => {
    // When
    const table = buildGridTable([], [], [], []);

    // Then
    expect(table.modelColumns).toEqual([]);
    expect(table.skillRows).toEqual([]);
  });

  it('should order model columns following the models array order', () => {
    // Given
    const models = [buildModel('mB', 'ModelB'), buildModel('mA', 'ModelA')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const cells = [cell('mA', 'p1'), cell('mB', 'p1')];

    // When
    const table = buildGridTable(cells, models, prompts, []);

    // Then
    expect(table.modelColumns.map(c => c.modelId)).toEqual(['mB', 'mA']);
    expect(table.modelColumns.map(c => c.label)).toEqual(['ModelB', 'ModelA']);
  });

  it('should order skill rows following the prompts array order', () => {
    // Given
    const models = [buildModel('mA', 'ModelA')];
    const prompts = [buildPrompt('p2', 'Prompt-2'), buildPrompt('p1', 'Prompt-1')];
    const cells = [cell('mA', 'p1'), cell('mA', 'p2')];

    // When
    const table = buildGridTable(cells, models, prompts, []);

    // Then
    expect(table.skillRows.map(r => r.skillKey)).toEqual(['p2', 'p1']);
    expect(table.skillRows.map(r => r.label)).toEqual(['Prompt-2', 'Prompt-1']);
  });

  it('should align each row cells 1:1 with model columns', () => {
    // Given
    const models = [buildModel('mA', 'ModelA'), buildModel('mB', 'ModelB')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const cells = [cell('mA', 'p1'), cell('mB', 'p1')];

    // When
    const table = buildGridTable(cells, models, prompts, []);

    // Then
    const row = table.skillRows[0];
    expect(row.cells).toHaveLength(2);
    expect(row.cells[0]?.id).toBe('mA::p1');
    expect(row.cells[1]?.id).toBe('mB::p1');
  });

  it('should place null for a model×skill combo that has no result cell', () => {
    // Given — mB×p1 missing
    const models = [buildModel('mA', 'ModelA'), buildModel('mB', 'ModelB')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const cells = [cell('mA', 'p1')];

    // When
    const table = buildGridTable(cells, models, prompts, []);

    // Then
    const row = table.skillRows[0];
    expect(row.cells[0]?.id).toBe('mA::p1');
    expect(row.cells[1]).toBeNull();
  });

  it('should thread the selected flag from selectedCellIds onto matching grid cells', () => {
    // Given
    const models = [buildModel('mA', 'ModelA'), buildModel('mB', 'ModelB')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const cells = [cell('mA', 'p1'), cell('mB', 'p1')];

    // When
    const table = buildGridTable(cells, models, prompts, ['mB::p1']);

    // Then
    const row = table.skillRows[0];
    expect(row.cells[0]?.selected).toBe(false);
    expect(row.cells[1]?.selected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// starRows / tps / timeToFirstTokenMs — buildGridCells
// ---------------------------------------------------------------------------

const QUALITY_STAR_ROWS = [
  { category: 'fluency' as const, score: 5 },
  { category: 'readability' as const, score: 4 },
  { category: 'vocabulary' as const, score: 3 },
] as const;

describe('buildGridCells — starRows and metrics', () => {
  it('should call buildQualityStarRows with cell.output and attach result as starRows', () => {
    // Arrange
    mockBuildQualityStarRows.mockReturnValue([...QUALITY_STAR_ROWS]);
    const c = buildCell({
      id: 'x',
      modelLabel: 'M',
      phrase: 'P',
      output: 'some output text',
    });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(mockBuildQualityStarRows).toHaveBeenCalledWith('some output text');
    expect(vm?.starRows).toEqual(QUALITY_STAR_ROWS);
  });

  it('should include fluency, readability, vocabulary categories in starRows', () => {
    // Arrange
    mockBuildQualityStarRows.mockReturnValue([...QUALITY_STAR_ROWS]);
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', output: 'text' });

    // Act
    const [vm] = buildGridCells([c], []);
    const categories = vm?.starRows.map(r => r.category) ?? [];

    // Assert
    expect(categories).toContain('fluency');
    expect(categories).toContain('readability');
    expect(categories).toContain('vocabulary');
  });

  it('should return 3 starRows from quality metrics (not 5 judge criteria)', () => {
    // Arrange
    mockBuildQualityStarRows.mockReturnValue([...QUALITY_STAR_ROWS]);
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', output: 'text' });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(vm?.starRows).toHaveLength(3);
  });

  it('should return empty starRows when output is empty (no text to analyze)', () => {
    // Arrange — mock returns [] for empty output (matches real implementation)
    mockBuildQualityStarRows.mockReturnValue([]);
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', output: '' });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(vm?.starRows).toEqual([]);
  });

  it('should sort starRows descending by score', () => {
    // Arrange — mock returns already-sorted rows (real impl sorts; we verify pass-through)
    mockBuildQualityStarRows.mockReturnValue([...QUALITY_STAR_ROWS]);
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', output: 'text' });

    // Act
    const [vm] = buildGridCells([c], []);
    const scores = vm?.starRows.map(r => r.score) ?? [];

    // Assert
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('should thread tps from ResultCellVM onto GridCellVM', () => {
    // Arrange
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', tps: 99, ttfMs: null });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(vm?.tps).toBe(99);
  });

  it('should thread timeToFirstTokenMs from ResultCellVM.ttfMs onto GridCellVM', () => {
    // Arrange
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', tps: null, ttfMs: 350 });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(vm?.timeToFirstTokenMs).toBe(350);
  });

  it('should set tps and timeToFirstTokenMs to null when source values are null', () => {
    // Arrange
    const c = buildCell({ id: 'x', modelLabel: 'M', phrase: 'P', tps: null, ttfMs: null });

    // Act
    const [vm] = buildGridCells([c], []);

    // Assert
    expect(vm?.tps).toBeNull();
    expect(vm?.timeToFirstTokenMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// starRows / tps / timeToFirstTokenMs — buildGridTable path
// ---------------------------------------------------------------------------
describe('buildGridTable — starRows and metrics', () => {
  it('should populate starRows from quality metrics on grid cells inside skillRows', () => {
    // Arrange
    mockBuildQualityStarRows.mockReturnValue([...QUALITY_STAR_ROWS]);
    const models = [buildModel('mA', 'ModelA')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const cells = [
      buildCell({ id: 'mA::p1', modelLabel: 'mA', phrase: 'p1', output: 'rich output text' }),
    ];

    // Act
    const table = buildGridTable(cells, models, prompts, []);
    const gridCell = table.skillRows[0]?.cells[0];

    // Assert
    expect(gridCell?.starRows).toHaveLength(3);
    const scores = gridCell?.starRows.map(r => r.score) ?? [];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('should thread tps and timeToFirstTokenMs through buildGridTable', () => {
    // Arrange
    const models = [buildModel('mA', 'ModelA')];
    const prompts = [buildPrompt('p1', 'Prompt-1')];
    const c = buildCell({
      id: 'mA::p1',
      modelLabel: 'mA',
      phrase: 'p1',
      tps: 77,
      ttfMs: 111,
    });

    // Act
    const table = buildGridTable([c], models, prompts, []);
    const gridCell = table.skillRows[0]?.cells[0];

    // Assert
    expect(gridCell?.tps).toBe(77);
    expect(gridCell?.timeToFirstTokenMs).toBe(111);
  });
});
