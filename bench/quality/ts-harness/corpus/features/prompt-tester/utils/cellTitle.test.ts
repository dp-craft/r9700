import { describe, expect, it } from 'vitest';

import { type CellTitleInput, formatCellTitle, PHRASE_MAX_LENGTH } from './cellTitle';

describe('formatCellTitle', () => {
  it('should produce full title with axis ids, model, and phrase when all present', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      promptAxisId: 2,
      modelLabel: 'deepseek-r1:latest (8.2B)',
      phrase: 'Explain quantum tunneling',
    };

    expect(formatCellTitle(input)).toBe(
      'M1 S2 · deepseek-r1:latest (8.2B) – Explain quantum tunneling'
    );
  });

  it('should omit model axis prefix when modelAxisId is missing', () => {
    const input: CellTitleInput = {
      promptAxisId: 2,
      modelLabel: 'llama3',
      phrase: 'Hello',
    };

    expect(formatCellTitle(input)).toBe('S2 · llama3 – Hello');
  });

  it('should omit prompt axis prefix when promptAxisId is missing', () => {
    const input: CellTitleInput = {
      modelAxisId: 3,
      modelLabel: 'llama3',
      phrase: 'Hello',
    };

    expect(formatCellTitle(input)).toBe('M3 · llama3 – Hello');
  });

  it('should omit model label when modelLabel is missing', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      promptAxisId: 2,
      phrase: 'Hello',
    };

    expect(formatCellTitle(input)).toBe('M1 S2 – Hello');
  });

  it('should omit phrase and its separator when phrase is missing', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      promptAxisId: 2,
      modelLabel: 'llama3',
    };

    expect(formatCellTitle(input)).toBe('M1 S2 · llama3');
  });

  it('should truncate a long phrase with an ellipsis', () => {
    const longPhrase = 'a'.repeat(PHRASE_MAX_LENGTH + 20);
    const input: CellTitleInput = {
      modelLabel: 'llama3',
      phrase: longPhrase,
    };

    const result = formatCellTitle(input);

    expect(result.endsWith('…')).toBe(true);
    expect(result).toBe(`llama3 – ${'a'.repeat(PHRASE_MAX_LENGTH)}…`);
  });

  it('should not truncate a phrase at exactly the max length', () => {
    const phrase = 'a'.repeat(PHRASE_MAX_LENGTH);
    const input: CellTitleInput = { phrase };

    const result = formatCellTitle(input);

    expect(result.includes('…')).toBe(false);
    expect(result).toBe(phrase);
  });

  it('should never emit a hash in the output', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      modelLabel: 'llama3',
      phrase: 'test',
    };

    expect(formatCellTitle(input)).not.toContain('#');
  });

  it('should return a reasonable fallback when everything is missing', () => {
    expect(formatCellTitle({})).toBe('Untitled');
  });

  it('should leave no dangling separators when only the phrase is present', () => {
    const input: CellTitleInput = { phrase: 'Just a phrase' };

    expect(formatCellTitle(input)).toBe('Just a phrase');
  });

  it('should leave no dangling separators when only axis ids are present', () => {
    const input: CellTitleInput = { modelAxisId: 4, promptAxisId: 5 };

    expect(formatCellTitle(input)).toBe('M4 S5');
  });

  it('should trim surrounding whitespace from the phrase before truncation', () => {
    const input: CellTitleInput = { phrase: '   spaced   ' };

    expect(formatCellTitle(input)).toBe('spaced');
  });
});
