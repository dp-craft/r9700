import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../buildRunAnalysis');

import { buildRunAnalysis } from '../buildRunAnalysis';
import { buildQualityStarRows, meanQualityStars } from '../starMetrics';

const mockAnalysis = vi.mocked(buildRunAnalysis);

const setAnalysis = (perplexity: number, readabilityGrade: number, lexicalDiversity: number) => {
  mockAnalysis.mockReturnValue({
    perplexity,
    readabilityGrade,
    lexicalDiversity,
    wordCount: 10,
    sentenceCount: 2,
    readingTimeMinutes: 0.1,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildQualityStarRows', () => {
  it('should return empty array when output is empty string', () => {
    expect(buildQualityStarRows('')).toEqual([]);
  });

  it('should return empty array when output is whitespace only', () => {
    expect(buildQualityStarRows('   ')).toEqual([]);
  });

  it('should not call buildRunAnalysis when output is empty', () => {
    buildQualityStarRows('');
    expect(mockAnalysis).not.toHaveBeenCalled();
  });

  it('should return exactly 3 rows for non-empty output', () => {
    setAnalysis(20, 5, 0.8);
    expect(buildQualityStarRows('hello world')).toHaveLength(3);
  });

  it('should include fluency, readability, and vocabulary categories', () => {
    setAnalysis(20, 5, 0.8);
    const rows = buildQualityStarRows('hello world');
    const categories = rows.map(r => r.category);
    expect(categories).toContain('fluency');
    expect(categories).toContain('readability');
    expect(categories).toContain('vocabulary');
  });

  it('should sort rows descending by score', () => {
    // fluency=1 (bad perplexity), readability=5 (grade<=6), vocabulary=4 (diversity>=0.6)
    setAnalysis(100, 5, 0.65);
    const rows = buildQualityStarRows('some text');
    const scores = rows.map(r => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  // Fluency thresholds (perplexity → classifyPerplexity → good/average/bad)
  it('should give fluency score 5 when perplexity is in good band (≤30)', () => {
    setAnalysis(30, 5, 0.8);
    const rows = buildQualityStarRows('text');
    const fluency = rows.find(r => r.category === 'fluency');
    expect(fluency?.score).toBe(5);
  });

  it('should give fluency score 3 when perplexity is in average band (31–80)', () => {
    setAnalysis(31, 5, 0.8);
    const rows = buildQualityStarRows('text');
    const fluency = rows.find(r => r.category === 'fluency');
    expect(fluency?.score).toBe(3);
  });

  it('should give fluency score 3 at boundary perplexity 80 (average)', () => {
    setAnalysis(80, 5, 0.8);
    const rows = buildQualityStarRows('text');
    const fluency = rows.find(r => r.category === 'fluency');
    expect(fluency?.score).toBe(3);
  });

  it('should give fluency score 1 when perplexity is in bad band (>80)', () => {
    setAnalysis(81, 5, 0.8);
    const rows = buildQualityStarRows('text');
    const fluency = rows.find(r => r.category === 'fluency');
    expect(fluency?.score).toBe(1);
  });

  // Readability thresholds
  it('should give readability score 5 when grade ≤ 6', () => {
    setAnalysis(20, 6, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(5);
  });

  it('should give readability score 4 when grade is 7–9 (boundary 9)', () => {
    setAnalysis(20, 9, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(4);
  });

  it('should give readability score 4 when grade is 7', () => {
    setAnalysis(20, 7, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(4);
  });

  it('should give readability score 3 when grade is 10–12 (boundary 12)', () => {
    setAnalysis(20, 12, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(3);
  });

  it('should give readability score 2 when grade is 13–15 (boundary 15)', () => {
    setAnalysis(20, 15, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(2);
  });

  it('should give readability score 1 when grade > 15', () => {
    setAnalysis(20, 16, 0.8);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'readability')?.score).toBe(1);
  });

  // Vocabulary thresholds
  it('should give vocabulary score 5 when lexicalDiversity ≥ 0.75', () => {
    setAnalysis(20, 5, 0.75);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'vocabulary')?.score).toBe(5);
  });

  it('should give vocabulary score 4 when lexicalDiversity is 0.6–0.74 (boundary 0.6)', () => {
    setAnalysis(20, 5, 0.6);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'vocabulary')?.score).toBe(4);
  });

  it('should give vocabulary score 3 when lexicalDiversity is 0.45–0.59 (boundary 0.45)', () => {
    setAnalysis(20, 5, 0.45);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'vocabulary')?.score).toBe(3);
  });

  it('should give vocabulary score 2 when lexicalDiversity is 0.3–0.44 (boundary 0.3)', () => {
    setAnalysis(20, 5, 0.3);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'vocabulary')?.score).toBe(2);
  });

  it('should give vocabulary score 1 when lexicalDiversity < 0.3', () => {
    setAnalysis(20, 5, 0.29);
    const rows = buildQualityStarRows('text');
    expect(rows.find(r => r.category === 'vocabulary')?.score).toBe(1);
  });
});

describe('meanQualityStars', () => {
  it('should return 0 for empty output', () => {
    expect(meanQualityStars('')).toBe(0);
  });

  it('should return 0 for whitespace-only output', () => {
    expect(meanQualityStars('   ')).toBe(0);
  });

  it('should return mean of the 3 metric scores', () => {
    // fluency=5 (good perplexity), readability=5 (grade<=6), vocabulary=5 (diversity>=0.75) → mean=5
    setAnalysis(20, 5, 0.8);
    expect(meanQualityStars('hello')).toBe(5);
  });

  it('should compute mean correctly when scores differ', () => {
    // fluency=1 (bad), readability=5 (grade<=6), vocabulary=5 (diversity>=0.75) → mean=(1+5+5)/3
    setAnalysis(100, 5, 0.8);
    expect(meanQualityStars('hello')).toBeCloseTo(11 / 3);
  });
});
