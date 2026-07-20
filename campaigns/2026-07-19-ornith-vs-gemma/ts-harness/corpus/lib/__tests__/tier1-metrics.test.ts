import { describe, expect, it } from 'vitest';

import { CHARS_PER_TOKEN } from '@/config';
import type { Tier1MetricsDTO } from '@/db/idb';
import { computeStructureScore, computeTier1Metrics } from '@/lib/tier1-metrics';

// -- Builders --

interface StreamTimings {
  readonly requestStartedAt: number;
  readonly firstTokenAt: number;
  readonly completedAt: number;
}

const createTimings = (overrides: Partial<StreamTimings> = {}): StreamTimings => ({
  requestStartedAt: 1000,
  firstTokenAt: 1200,
  completedAt: 2000,
  ...overrides,
});

// -- computeStructureScore --

describe('computeStructureScore', () => {
  // -- Positive paths --

  it('should return score > 0 for text with headings', () => {
    const text = '# Heading\n\nSome content below.';

    const result = computeStructureScore(text);

    expect(result).toBeGreaterThan(0);
  });

  it('should return higher score for text with multiple structural elements', () => {
    const simpleText = '# Heading\n\nA paragraph.';
    const richText = [
      '# Heading',
      '',
      'A paragraph of text.',
      '',
      '- item one',
      '- item two',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '## Sub heading',
      '',
      '1. First step',
      '2. Second step',
    ].join('\n');

    const simpleScore = computeStructureScore(simpleText);
    const richScore = computeStructureScore(richText);

    expect(richScore).toBeGreaterThan(simpleScore);
  });

  it('should count code blocks delimited by triple backticks', () => {
    const textWithCodeBlock = ['Some text.', '', '```', 'code here', '```'].join('\n');
    const textWithoutCodeBlock = 'Some text.\n\nMore text.';

    const withCode = computeStructureScore(textWithCodeBlock);
    const withoutCode = computeStructureScore(textWithoutCodeBlock);

    expect(withCode).toBeGreaterThan(withoutCode);
  });

  // -- Negative cases --

  it('should return 0 for plain text without structural elements', () => {
    const text = 'This is just a single line of plain text with no formatting.';

    const result = computeStructureScore(text);

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should return 0 for empty string', () => {
    const result = computeStructureScore('');

    expect(result).toBe(0);
  });

  it('should return score between 0 and 1 inclusive', () => {
    const texts = [
      '',
      'plain text',
      '# Heading\n\n- list item\n\n```\ncode\n```\n\n## Another\n\n1. ordered',
      '# H1\n## H2\n### H3\n#### H4\n- a\n- b\n- c\n* d\n1. e\n2. f\n```\nx\n```\n```\ny\n```\n\nParagraph one.\n\nParagraph two.\n\nParagraph three.',
    ];

    texts.forEach(text => {
      const result = computeStructureScore(text);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  it('should detect unordered list items starting with dash', () => {
    const text = '- item one\n- item two\n- item three';

    const result = computeStructureScore(text);

    expect(result).toBeGreaterThan(0);
  });

  it('should detect unordered list items starting with asterisk', () => {
    const text = '* item one\n* item two';

    const result = computeStructureScore(text);

    expect(result).toBeGreaterThan(0);
  });

  it('should detect ordered list items', () => {
    const text = '1. first\n2. second\n3. third';

    const result = computeStructureScore(text);

    expect(result).toBeGreaterThan(0);
  });

  it('should detect paragraphs separated by blank lines', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';

    const result = computeStructureScore(text);

    expect(result).toBeGreaterThan(0);
  });
});

// -- computeTier1Metrics --

describe('computeTier1Metrics', () => {
  // -- Positive paths --

  it('should compute responseTimeMs from completedAt minus requestStartedAt', () => {
    const timings = createTimings({ requestStartedAt: 1000, completedAt: 3500 });

    const result = computeTier1Metrics('Hello world', timings);

    expect(result.responseTimeMs).toBe(2500);
  });

  it('should compute timeToFirstTokenMs from firstTokenAt minus requestStartedAt', () => {
    const timings = createTimings({ requestStartedAt: 1000, firstTokenAt: 1350 });

    const result = computeTier1Metrics('Hello world', timings);

    expect(result.timeToFirstTokenMs).toBe(350);
  });

  it('should compute charCount as text length', () => {
    const text = 'Hello world';

    const result = computeTier1Metrics(text, createTimings());

    expect(result.charCount).toBe(11);
  });

  it('should compute wordCount from whitespace-split words', () => {
    const text = 'The quick brown fox jumps';

    const result = computeTier1Metrics(text, createTimings());

    expect(result.wordCount).toBe(5);
  });

  it('should compute estimatedTokens using CHARS_PER_TOKEN', () => {
    const text = 'abcdefghijklmnop'; // 16 chars => 16/4 = 4 tokens

    const result = computeTier1Metrics(text, createTimings());

    expect(result.estimatedTokens).toBe(Math.ceil(text.length / CHARS_PER_TOKEN));
  });

  it('should count code blocks in codeBlockCount', () => {
    const text = [
      'Some text.',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      'Middle text.',
      '',
      '```python',
      'x = 1',
      '```',
    ].join('\n');

    const result = computeTier1Metrics(text, createTimings());

    expect(result.codeBlockCount).toBe(2);
  });

  it('should include structureScore from computeStructureScore', () => {
    const structuredText = '# Heading\n\n- item\n\n```\ncode\n```';

    const result = computeTier1Metrics(structuredText, createTimings());

    expect(result.structureScore).toBe(computeStructureScore(structuredText));
    expect(result.structureScore).toBeGreaterThan(0);
  });

  it('should return all fields matching Tier1MetricsDTO shape', () => {
    const text = 'Hello world';
    const timings = createTimings();

    const result = computeTier1Metrics(text, timings);

    expect(result).toEqual<Tier1MetricsDTO>({
      responseTimeMs: expect.any(Number) as number,
      timeToFirstTokenMs: expect.any(Number) as number,
      charCount: expect.any(Number) as number,
      wordCount: expect.any(Number) as number,
      estimatedTokens: expect.any(Number) as number,
      codeBlockCount: expect.any(Number) as number,
      structureScore: expect.any(Number) as number,
    });
  });

  // -- Edge cases --

  it('should handle empty response text', () => {
    const result = computeTier1Metrics('', createTimings());

    expect(result.charCount).toBe(0);
    expect(result.wordCount).toBe(0);
    expect(result.estimatedTokens).toBe(0);
    expect(result.codeBlockCount).toBe(0);
    expect(result.structureScore).toBe(0);
    expect(result.responseTimeMs).toBe(1000);
    expect(result.timeToFirstTokenMs).toBe(200);
  });

  it('should ceil estimatedTokens when char count is not divisible by CHARS_PER_TOKEN', () => {
    const text = 'abcde'; // 5 chars => ceil(5/4) = 2

    const result = computeTier1Metrics(text, createTimings());

    expect(result.estimatedTokens).toBe(2);
  });

  it('should handle text with only whitespace', () => {
    const text = '   \n\n  \t  ';

    const result = computeTier1Metrics(text, createTimings());

    expect(result.charCount).toBe(text.length);
    expect(result.wordCount).toBe(0);
  });

  it('should handle single word text', () => {
    const text = 'Hello';

    const result = computeTier1Metrics(text, createTimings());

    expect(result.wordCount).toBe(1);
  });

  it('should handle zero time difference when all timings are equal', () => {
    const timings = createTimings({
      requestStartedAt: 5000,
      firstTokenAt: 5000,
      completedAt: 5000,
    });

    const result = computeTier1Metrics('text', timings);

    expect(result.responseTimeMs).toBe(0);
    expect(result.timeToFirstTokenMs).toBe(0);
  });

  it('should count zero code blocks when none are present', () => {
    const text = 'Just plain text without any code blocks at all.';

    const result = computeTier1Metrics(text, createTimings());

    expect(result.codeBlockCount).toBe(0);
  });
});
