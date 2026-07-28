import { describe, expect, it } from 'vitest';

import type { Tier2MetricsDTO } from '@/db/idb';

import type {
  CellResult,
  CompareMetricRow,
  ModelParamsReadOnlyLabels,
  ResolvedModelSnapshot,
  SliderValues
} from '../../types';
import {
  ANALYZING_SENTINEL,
  buildCompareRows,
  type CompareMetricLabels,
  type CompareRowLabels
} from '../buildCompareRows';

const buildRowLabels = (): CompareRowLabels => ({
  temp: 'Temp',
  topP: 'Top-P',
  thinking: 'Thinking',
  latency: 'Latency',
  yes: 'Yes',
  no: 'No',
});

const buildMetricLabels = (): CompareMetricLabels => ({
  latency: 'Latency',
  tps: 'Tokens/s',
  perplexity: 'Perplexity',
  readability: 'Readability',
  lexicalDiversity: 'Lexical diversity',
  wordCount: 'Words',
  sentenceCount: 'Sentences',
  readingTime: 'Reading time',
  sentiment: 'Sentiment',
  passiveVoiceRatio: 'Passive Voice',
  questionDensity: 'Question Density',
  ngramRepetition: 'n-gram TF-IDF repetition',
  namedEntityCount: 'Named Entities',
  avgSentenceLength: 'Avg Sentence Length',
  hedgingDensity: 'Hedging Density',
});

const buildLabels = (): ModelParamsReadOnlyLabels => ({
  temp: 'Temperature',
  topP: 'Top P',
  maxTok: 'Max tokens',
  freq: 'Frequency',
  pres: 'Presence',
  contextSize: 'Context size',
  thinking: 'Thinking mode',
  thinkingBudget: 'Thinking budget',
});

const buildSliderValues = (overrides: Partial<SliderValues> = {}): SliderValues => ({
  temp: 0.7,
  topP: 1.0,
  maxTok: 2048,
  freq: 0,
  pres: 0,
  ...overrides,
});

const buildResolvedModel = (
  overrides: Partial<ResolvedModelSnapshot> = {}
): ResolvedModelSnapshot => ({
  name: 'GPT-4o',
  providerId: 'chatgpt',
  modelKey: 'gpt-4o',
  params: buildSliderValues(),
  thinking: false,
  ...overrides,
});

const buildTier2 = (overrides: Partial<Tier2MetricsDTO> = {}): Tier2MetricsDTO => ({
  lexicalDiversity: 0.5,
  repetitionScore: 0,
  readabilityGrade: 8,
  readabilityApproximate: false,
  rouge1: null,
  rouge2: null,
  bleu: null,
  keywordPresence: null,
  jaccardSimilarity: null,
  perplexity: null,
  sentiment: null,
  passiveVoiceRatio: null,
  questionDensity: null,
  avgSentenceLength: null,
  hedgingDensity: null,
  namedEntityCount: null,
  ...overrides,
});

const buildCell = (overrides: Partial<CellResult> = {}): CellResult => ({
  id: 'cell-1',
  modelId: 'model-1',
  promptId: 'prompt-1',
  userPromptHash: 'hash-1',
  output: 'Hello world',
  latencyMs: 1200,
  tokens: 150,
  cost: 0.002,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  ...overrides,
});

const EXPECTED_METRIC_ORDER: readonly string[] = [
  'latency',
  'tps',
  'perplexity',
  'perplexity-true',
  'readability',
  'lexicalDiversity',
  'wordCount',
  'sentenceCount',
  'readingTime',
  'sentiment',
  'passiveVoiceRatio',
  'questionDensity',
  'ngramRepetition',
  'namedEntityCount',
  'avgSentenceLength',
  'hedgingDensity',
];

const run = (cells: readonly CellResult[]) =>
  buildCompareRows(
    cells,
    cells.map(c => c.id),
    buildLabels(),
    buildRowLabels(),
    buildMetricLabels()
  );

describe('buildCompareRows', () => {
  it('should build one diff pane per cell with model name as label', () => {
    const cells: CellResult[] = [
      buildCell({
        id: 'cell-1',
        output: 'Response A',
        resolvedModel: buildResolvedModel({ name: 'GPT-4o' }),
      }),
      buildCell({
        id: 'cell-2',
        output: 'Response B',
        resolvedModel: buildResolvedModel({ name: 'Claude 3' }),
      }),
    ];

    const { diffPanes } = run(cells);

    expect(diffPanes).toHaveLength(2);
    expect(diffPanes[0]).toEqual({ label: 'GPT-4o', text: 'Response A' });
    expect(diffPanes[1]).toEqual({ label: 'Claude 3', text: 'Response B' });
  });

  it('should expose metricRows and no longer expose paramRows', () => {
    const result = run([buildCell()]);

    expect('paramRows' in result).toBe(false);
    expect(Array.isArray(result.metricRows)).toBe(true);
  });

  it('should build the performance metrics in fixed order', () => {
    const { metricRows } = run([buildCell()]);

    expect(metricRows.map((r: CompareMetricRow): string => r.metricKey)).toEqual(
      EXPECTED_METRIC_ORDER
    );
  });

  it('should mark only the perplexity row as an estimate', () => {
    const { metricRows } = run([buildCell()]);

    const estimateKeys = metricRows
      .filter((r: CompareMetricRow): boolean => r.isEstimate)
      .map((r: CompareMetricRow): string => r.metricKey);

    expect(estimateKeys).toEqual(['perplexity']);
  });

  it('should retain the entropy-estimate perplexity row marked as an estimate', () => {
    const { metricRows } = run([buildCell({ output: 'Alpha beta gamma delta.' })]);

    const estimate = metricRows.find(
      (r: CompareMetricRow): boolean => r.metricKey === 'perplexity'
    );

    expect(estimate?.isEstimate).toBe(true);
    expect(estimate?.values[0]).toMatch(/^\d+\.\d{2}$/);
  });

  it('should expose a true-perplexity row sourced from tier2.perplexity', () => {
    const cells: CellResult[] = [buildCell({ tier2: buildTier2({ perplexity: 12.34 }) })];

    const { metricRows } = run(cells);
    const trueRow = metricRows.find(
      (r: CompareMetricRow): boolean => r.metricKey === 'perplexity-true'
    );

    expect(trueRow?.isEstimate).toBe(false);
    expect(trueRow?.values[0]).toBe('12.34');
  });

  it('should show "—" for the true-perplexity row when tier2 is absent', () => {
    const cells: CellResult[] = [buildCell({ tier2: undefined })];

    const { metricRows } = run(cells);
    const trueRow = metricRows.find(
      (r: CompareMetricRow): boolean => r.metricKey === 'perplexity-true'
    );

    expect(trueRow?.values[0]).toBe('—');
  });

  it('should show "—" for the true-perplexity row when tier2.perplexity is null', () => {
    const cells: CellResult[] = [buildCell({ tier2: buildTier2({ perplexity: null }) })];

    const { metricRows } = run(cells);
    const trueRow = metricRows.find(
      (r: CompareMetricRow): boolean => r.metricKey === 'perplexity-true'
    );

    expect(trueRow?.values[0]).toBe('—');
  });

  it('should align metric values one-per-cell in cellCards order', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', latencyMs: 1200, output: 'Alpha beta gamma.' }),
      buildCell({ id: 'cell-2', latencyMs: 850, output: 'Delta.' }),
    ];

    const { metricRows, cellCards } = run(cells);
    const latency = metricRows.find((r: CompareMetricRow): boolean => r.metricKey === 'latency');

    expect(cellCards).toHaveLength(2);
    expect(latency?.values).toHaveLength(2);
    expect(latency?.values).toEqual(['1200 ms', '850 ms']);
  });

  it('should source tps from the cell tps field and fall back when absent', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', tps: 42.5 }),
      buildCell({ id: 'cell-2', tps: undefined }),
    ];

    const { metricRows } = run(cells);
    const tps = metricRows.find((r: CompareMetricRow): boolean => r.metricKey === 'tps');

    expect(tps?.values[0]).toContain('42.5');
    expect(tps?.values[1]).toBe('—');
  });

  it('should produce safe values for empty output', () => {
    const { metricRows } = run([buildCell({ output: '' })]);

    for (const row of metricRows) {
      expect(typeof row.values[0]).toBe('string');
      expect(row.values[0].length).toBeGreaterThan(0);
    }
  });

  it('should label metric rows from the provided metricLabels', () => {
    const { metricRows } = run([buildCell()]);
    const labels = buildMetricLabels();

    const labelOf = (key: string): string | undefined =>
      metricRows.find((r: CompareMetricRow): boolean => r.metricKey === key)?.label;

    expect(labelOf('latency')).toBe(labels.latency);
    expect(labelOf('perplexity')).toBe(labels.perplexity);
    expect(labelOf('readingTime')).toBe(labels.readingTime);
  });

  it('should show "—" diff-pane label for cells without resolvedModel', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', output: 'Response A', resolvedModel: undefined }),
      buildCell({
        id: 'cell-2',
        output: 'Response B',
        resolvedModel: buildResolvedModel({ name: 'Claude 3' }),
      }),
    ];

    const { diffPanes, cellCards } = run(cells);

    expect(diffPanes[0].label).toBe('—');
    expect(diffPanes[1].label).toBe('Claude 3');
    expect(cellCards.map(c => c.label)).toEqual(['—', 'Claude 3']);
  });

  it('should handle 3 cells producing 3 diff panes and 3-element cellCards', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', output: 'A', resolvedModel: buildResolvedModel({ name: 'M1' }) }),
      buildCell({ id: 'cell-2', output: 'B', resolvedModel: buildResolvedModel({ name: 'M2' }) }),
      buildCell({ id: 'cell-3', output: 'C', resolvedModel: buildResolvedModel({ name: 'M3' }) }),
    ];

    const { diffPanes, metricRows, cellCards } = run(cells);

    expect(diffPanes).toHaveLength(3);
    expect(cellCards).toHaveLength(3);
    expect(cellCards.map(c => c.label)).toEqual(['M1', 'M2', 'M3']);
    for (const row of metricRows) {
      expect(row.values).toHaveLength(3);
    }
  });

  it('should build one cellCard per compared cell carrying full model params', () => {
    const cells: CellResult[] = [
      buildCell({
        id: 'cell-1',
        resolvedModel: buildResolvedModel({ name: 'Claude 3.5 Sonnet' }),
      }),
      buildCell({ id: 'cell-2', resolvedModel: buildResolvedModel({ name: 'GPT-4o' }) }),
    ];

    const { cellCards } = run(cells);

    expect(cellCards).toHaveLength(2);
    expect(cellCards[0].label).toBe('Claude 3.5 Sonnet');
    expect(cellCards[1].label).toBe('GPT-4o');
    expect(cellCards[0].modelParams).toBeDefined();
    expect(cellCards[0].modelParams.labels).toEqual(buildLabels());
  });

  it('should carry every drawer param in the cell card model params', () => {
    const cells: CellResult[] = [
      buildCell({
        id: 'cell-1',
        resolvedModel: buildResolvedModel({
          name: 'Claude 3.5 Sonnet',
          params: buildSliderValues({
            temp: 0.7,
            topP: 0.9,
            maxTok: 4096,
            contextSize: 131072,
          }),
          thinking: true,
        }),
      }),
    ];

    const { cellCards } = run(cells);
    const params = cellCards[0].modelParams;

    expect(params.params.temp).toBe(0.7);
    expect(params.params.topP).toBe(0.9);
    expect(params.params.maxTok).toBe(4096);
    expect(params.params.contextSize).toBe(131072);
    expect(params.thinking).toBe(true);
  });

  it('should degrade gracefully with "—" label when resolvedModel is missing', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', resolvedModel: undefined })];

    const { cellCards } = run(cells);

    expect(cellCards[0].label).toBe('—');
    expect(cellCards[0].modelParams.thinking).toBe(false);
  });

  it('should filter to only selectedCellIds when a subset is provided', () => {
    const cells: CellResult[] = [
      buildCell({
        id: 'cell-1',
        output: 'Alpha',
        resolvedModel: buildResolvedModel({ name: 'M1' }),
      }),
      buildCell({
        id: 'cell-2',
        output: 'Beta',
        resolvedModel: buildResolvedModel({ name: 'M2' }),
      }),
      buildCell({
        id: 'cell-3',
        output: 'Gamma',
        resolvedModel: buildResolvedModel({ name: 'M3' }),
      }),
    ];

    const { diffPanes, cellCards, metricRows } = buildCompareRows(
      cells,
      ['cell-1', 'cell-3'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels()
    );

    expect(diffPanes).toHaveLength(2);
    expect(cellCards).toHaveLength(2);
    expect(cellCards.map(c => c.label)).toEqual(['M1', 'M3']);
    for (const row of metricRows) {
      expect(row.values).toHaveLength(2);
    }
    const texts = diffPanes.map(p => p.text);
    expect(texts).toContain('Alpha');
    expect(texts).toContain('Gamma');
    expect(texts).not.toContain('Beta');
  });

  const findMetricValue = (rows: readonly CompareMetricRow[], key: string): string | undefined =>
    rows.find((r: CompareMetricRow): boolean => r.metricKey === key)?.values[0];

  it('should render the 7 text-metric rows from tier2 fields when set', () => {
    const cells: CellResult[] = [
      buildCell({
        tier2: buildTier2({
          sentiment: 0.25,
          passiveVoiceRatio: 0.125,
          questionDensity: 0.5,
          repetitionScore: 0.333,
          namedEntityCount: 4,
          avgSentenceLength: 12.6,
          hedgingDensity: 0.075,
        }),
      }),
    ];

    const { metricRows } = run(cells);

    expect(findMetricValue(metricRows, 'sentiment')).toBe('0.250');
    expect(findMetricValue(metricRows, 'passiveVoiceRatio')).toBe('0.125');
    expect(findMetricValue(metricRows, 'questionDensity')).toBe('0.500');
    expect(findMetricValue(metricRows, 'ngramRepetition')).toBe('0.333');
    expect(findMetricValue(metricRows, 'namedEntityCount')).toBe('4');
    expect(findMetricValue(metricRows, 'avgSentenceLength')).toBe('12.6');
    expect(findMetricValue(metricRows, 'hedgingDensity')).toBe('0.075');
  });

  it('should show "—" for all 7 text-metric rows when tier2 is absent', () => {
    const { metricRows } = run([buildCell({ tier2: undefined })]);

    for (const key of [
      'sentiment',
      'passiveVoiceRatio',
      'questionDensity',
      'ngramRepetition',
      'namedEntityCount',
      'avgSentenceLength',
      'hedgingDensity',
    ]) {
      expect(findMetricValue(metricRows, key)).toBe('—');
    }
  });

  it('should show "—" for nullable text-metric rows when the tier2 field is null', () => {
    const { metricRows } = run([
      buildCell({ tier2: buildTier2({ sentiment: null, namedEntityCount: null }) }),
    ]);

    expect(findMetricValue(metricRows, 'sentiment')).toBe('—');
    expect(findMetricValue(metricRows, 'namedEntityCount')).toBe('—');
  });

  it('should render namedEntityCount as an integer string', () => {
    const { metricRows } = run([buildCell({ tier2: buildTier2({ namedEntityCount: 7 }) })]);

    expect(findMetricValue(metricRows, 'namedEntityCount')).toBe('7');
  });

  it('should signal analyzing for the true-perplexity cell when analyzingCellIds includes the cell', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', tier2: undefined })];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-1']
    );

    expect(findMetricValue(metricRows, 'perplexity-true')).toBe(ANALYZING_SENTINEL);
  });

  it('should signal ANALYZING_SENTINEL for every matching cell when analyzingCellIds contains multiple ids', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', tier2: undefined }),
      buildCell({ id: 'cell-2', tier2: undefined }),
      buildCell({ id: 'cell-3', tier2: buildTier2({ perplexity: 5.0 }) }),
    ];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1', 'cell-2', 'cell-3'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-1', 'cell-2']
    );

    const trueRow = metricRows.find(
      (r: CompareMetricRow): boolean => r.metricKey === 'perplexity-true'
    );
    // cell-1 and cell-2: analyzing (no tier2.perplexity) → ANALYZING_SENTINEL
    expect(trueRow?.values[0]).toBe(ANALYZING_SENTINEL);
    expect(trueRow?.values[1]).toBe(ANALYZING_SENTINEL);
    // cell-3: already has perplexity → show value, not sentinel
    expect(trueRow?.values[2]).toBe('5.00');
  });

  it('should expose ANALYZING_SENTINEL as a value distinct from the "—" fallback', () => {
    expect(ANALYZING_SENTINEL).not.toBe('—');
  });

  it('should keep "—" for the true-perplexity cell when analyzingCellIds does not include the cell', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', tier2: undefined })];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-other']
    );

    expect(findMetricValue(metricRows, 'perplexity-true')).toBe('—');
  });

  it('should not signal analyzing when the matching cell already has a true-perplexity value', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', tier2: buildTier2({ perplexity: 9.5 }) }),
    ];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-1']
    );

    expect(findMetricValue(metricRows, 'perplexity-true')).toBe('9.50');
  });

  it('should not signal analyzing for non-perplexity rows even when analyzingCellIds includes the cell', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', tier2: undefined })];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-1']
    );

    expect(findMetricValue(metricRows, 'sentiment')).toBe('—');
    expect(findMetricValue(metricRows, 'tps')).not.toBe(ANALYZING_SENTINEL);
  });

  const findQualities = (
    rows: readonly CompareMetricRow[],
    key: string
  ): readonly (string | undefined)[] | undefined =>
    rows.find((r: CompareMetricRow): boolean => r.metricKey === key)?.qualities;

  it('should expose data-quality bands across all three bands for the true-perplexity row', () => {
    const cells: CellResult[] = [
      buildCell({ id: 'cell-1', tier2: buildTier2({ perplexity: 8.2 }) }),
      buildCell({ id: 'cell-2', tier2: buildTier2({ perplexity: 50 }) }),
      buildCell({ id: 'cell-3', tier2: buildTier2({ perplexity: 120 }) }),
    ];

    const { metricRows } = run(cells);

    expect(findQualities(metricRows, 'perplexity-true')).toEqual(['good', 'average', 'bad']);
  });

  it('should leave the band undefined for a true-perplexity cell with no numeric value', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', tier2: undefined })];

    const { metricRows } = run(cells);

    expect(findQualities(metricRows, 'perplexity-true')).toEqual([undefined]);
  });

  it('should leave the band undefined for a true-perplexity cell that is analyzing', () => {
    const cells: CellResult[] = [buildCell({ id: 'cell-1', tier2: undefined })];

    const { metricRows } = buildCompareRows(
      cells,
      ['cell-1'],
      buildLabels(),
      buildRowLabels(),
      buildMetricLabels(),
      ['cell-1']
    );

    expect(findQualities(metricRows, 'perplexity-true')).toEqual([undefined]);
  });

  it('should not attach quality bands to non-perplexity-true metric rows', () => {
    const { metricRows } = run([buildCell({ tier2: buildTier2({ perplexity: 8.2 }) })]);

    expect(findQualities(metricRows, 'perplexity')).toBeUndefined();
    expect(findQualities(metricRows, 'latency')).toBeUndefined();
    expect(findQualities(metricRows, 'sentiment')).toBeUndefined();
  });

  it('should mark the 7 text-metric rows as non-estimates', () => {
    const { metricRows } = run([buildCell({ tier2: buildTier2() })]);

    for (const key of [
      'sentiment',
      'passiveVoiceRatio',
      'questionDensity',
      'ngramRepetition',
      'namedEntityCount',
      'avgSentenceLength',
      'hedgingDensity',
    ]) {
      const row = metricRows.find((r: CompareMetricRow): boolean => r.metricKey === key);
      expect(row?.isEstimate).toBe(false);
    }
  });
});
