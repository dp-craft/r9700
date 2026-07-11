import { describe, expect, it } from 'vitest';

import { aggregateGrades, renderStatsMarkdown } from '../aggregate-grades';
import type { BarVerdict, RunnerGrade } from '../grade-schema';

const bars = (faithful: 'pass' | 'fail' | 'na'): readonly BarVerdict[] => [
  { bar: 'faithfulTest', verdict: faithful, evidence: 'e' },
  { bar: 'correctImpl', verdict: 'pass', evidence: 'e' },
  { bar: 'gateClean', verdict: 'pass', evidence: 'e' },
  { bar: 'reviewable', verdict: 'pass', evidence: 'e' },
];

const grade = (over: Partial<RunnerGrade>): RunnerGrade => ({
  runId: 'r',
  modelId: 'm1',
  furthestStage: 'green',
  bars: bars('pass'),
  primaryGap: 'none',
  fixDistance: 'trivial',
  mergeable: true,
  notes: '',
  ...over,
});

describe('aggregateGrades', () => {
  it('should count total grades', () => {
    const stats = aggregateGrades([grade({}), grade({ runId: 'r2' })]);

    expect(stats.total).toBe(2);
  });

  it('should build a per-furthestStage distribution', () => {
    const stats = aggregateGrades([
      grade({ furthestStage: 'green' }),
      grade({ furthestStage: 'red' }),
      grade({ furthestStage: 'green' }),
    ]);

    expect(stats.byFurthestStage.green).toBe(2);
    expect(stats.byFurthestStage.red).toBe(1);
  });

  it('should build a per-primaryGap frequency map', () => {
    const stats = aggregateGrades([
      grade({ primaryGap: 'gate-tsc' }),
      grade({ primaryGap: 'gate-tsc' }),
      grade({ primaryGap: 'vacuous-test' }),
    ]);

    expect(stats.byPrimaryGap['gate-tsc']).toBe(2);
    expect(stats.byPrimaryGap['vacuous-test']).toBe(1);
  });

  it('should build a per-model breakdown', () => {
    const stats = aggregateGrades([grade({ modelId: 'm1' }), grade({ modelId: 'm2' })]);

    expect(stats.byModel.m1).toBe(1);
    expect(stats.byModel.m2).toBe(1);
  });

  it('should count mergeable grades', () => {
    const stats = aggregateGrades([grade({ mergeable: true }), grade({ mergeable: false })]);

    expect(stats.mergeableCount).toBe(1);
  });

  it('should compute a mergeable rate', () => {
    const stats = aggregateGrades([grade({ mergeable: true }), grade({ mergeable: false })]);

    expect(stats.mergeableRate).toBeCloseTo(0.5);
  });

  it('should report a zero mergeable rate for an empty input without NaN', () => {
    const stats = aggregateGrades([]);

    expect(stats.mergeableRate).toBe(0);
    expect(Number.isNaN(stats.mergeableRate)).toBe(false);
  });

  it('should flag false-green-risk when furthestStage is green but faithfulTest failed', () => {
    const stats = aggregateGrades([
      grade({ furthestStage: 'green', bars: bars('fail') }),
      grade({ furthestStage: 'green', bars: bars('pass') }),
    ]);

    expect(stats.falseGreenRiskCount).toBe(1);
  });

  it('should flag false-green-risk for a done furthestStage with failing faithfulTest', () => {
    const stats = aggregateGrades([grade({ furthestStage: 'done', bars: bars('fail') })]);

    expect(stats.falseGreenRiskCount).toBe(1);
  });

  it('should not flag false-green-risk when furthestStage is red even if faithfulTest failed', () => {
    const stats = aggregateGrades([grade({ furthestStage: 'red', bars: bars('fail') })]);

    expect(stats.falseGreenRiskCount).toBe(0);
  });
});

describe('renderStatsMarkdown', () => {
  it('should include the total count in the report', () => {
    const md = renderStatsMarkdown(aggregateGrades([grade({})]));

    expect(md).toContain('1');
  });

  it('should render a markdown table row for a furthest stage', () => {
    const md = renderStatsMarkdown(aggregateGrades([grade({ furthestStage: 'green' })]));

    expect(md).toContain('green');
    expect(md).toContain('|');
  });

  it('should surface the false-green-risk count in the report', () => {
    const md = renderStatsMarkdown(
      aggregateGrades([grade({ furthestStage: 'green', bars: bars('fail') })])
    );

    expect(md.toLowerCase()).toContain('false');
  });

  it('should render a per-model row', () => {
    const md = renderStatsMarkdown(aggregateGrades([grade({ modelId: 'm-xyz' })]));

    expect(md).toContain('m-xyz');
  });
});
