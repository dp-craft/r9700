import { describe, expect, it } from 'vitest';

import {
  classifyPerplexity,
  PERPLEXITY_AVERAGE_MAX,
  PERPLEXITY_GOOD_MAX
} from '../perplexityQuality';

describe('classifyPerplexity', () => {
  it('should classify a low value as good when below the good threshold', () => {
    expect(classifyPerplexity(29.9)).toBe('good');
  });

  it('should classify the good threshold as good when value equals the inclusive boundary', () => {
    expect(classifyPerplexity(PERPLEXITY_GOOD_MAX)).toBe('good');
  });

  it('should classify as average when value is just above the good threshold', () => {
    expect(classifyPerplexity(30.1)).toBe('average');
  });

  it('should classify the average threshold as average when value equals the inclusive boundary', () => {
    expect(classifyPerplexity(PERPLEXITY_AVERAGE_MAX)).toBe('average');
  });

  it('should classify as bad when value is just above the average threshold', () => {
    expect(classifyPerplexity(80.1)).toBe('bad');
  });

  it('should classify a high value as bad when far above the average threshold', () => {
    expect(classifyPerplexity(500)).toBe('bad');
  });

  it('should expose tunable thresholds as named constants', () => {
    expect(PERPLEXITY_GOOD_MAX).toBe(30);
    expect(PERPLEXITY_AVERAGE_MAX).toBe(80);
  });
});
