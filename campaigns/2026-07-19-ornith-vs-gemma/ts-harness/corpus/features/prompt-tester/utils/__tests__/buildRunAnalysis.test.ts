import { describe, expect, it } from 'vitest';

import {
  computeLexicalDiversity,
  computePerplexityEstimate,
  computeReadabilityGrade,
  computeReadingTimeMinutes,
  computeSentenceCount,
  computeWordCount
} from '@/lib/text-metrics';

import { buildRunAnalysis } from '../buildRunAnalysis';

const SAMPLE = 'The quick brown fox jumps. The lazy dog sleeps soundly.';

describe('buildRunAnalysis', () => {
  it('should map wordCount to computeWordCount when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).wordCount).toBe(computeWordCount(SAMPLE));
  });

  it('should map sentenceCount to computeSentenceCount when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).sentenceCount).toBe(computeSentenceCount(SAMPLE));
  });

  it('should map readingTimeMinutes to computeReadingTimeMinutes when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).readingTimeMinutes).toBe(computeReadingTimeMinutes(SAMPLE));
  });

  it('should map perplexity to computePerplexityEstimate when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).perplexity).toBe(computePerplexityEstimate(SAMPLE));
  });

  it('should map lexicalDiversity to computeLexicalDiversity when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).lexicalDiversity).toBe(computeLexicalDiversity(SAMPLE));
  });

  it('should map readabilityGrade to computeReadabilityGrade when text is non-empty', () => {
    expect(buildRunAnalysis(SAMPLE).readabilityGrade).toBe(computeReadabilityGrade(SAMPLE));
  });

  it('should return all zeros when text is an empty string', () => {
    expect(buildRunAnalysis('')).toEqual({
      wordCount: 0,
      sentenceCount: 0,
      readingTimeMinutes: 0,
      perplexity: 0,
      lexicalDiversity: 0,
      readabilityGrade: 0,
    });
  });

  it('should return all zeros when text is whitespace only', () => {
    expect(buildRunAnalysis('   \n\t  ')).toEqual({
      wordCount: 0,
      sentenceCount: 0,
      readingTimeMinutes: 0,
      perplexity: 0,
      lexicalDiversity: 0,
      readabilityGrade: 0,
    });
  });
});
