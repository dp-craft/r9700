import { describe, expect, it } from 'vitest';

import { type CellTitleInput, formatCellTitle } from '../cellTitle';

describe('formatCellTitle', () => {
  it('should format with both axis IDs using middle dot separator', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      promptAxisId: 2,
      modelLabel: 'gpt-4o',
      phrase: 'Explain gravity',
    };

    expect(formatCellTitle(input)).toBe('M1 S2 · gpt-4o – Explain gravity');
  });

  it('should format with only model axis ID when no prompt axis', () => {
    const input: CellTitleInput = {
      modelAxisId: 3,
      modelLabel: 'claude-3.5-sonnet',
      phrase: 'Write a haiku',
    };

    expect(formatCellTitle(input)).toBe('M3 · claude-3.5-sonnet – Write a haiku');
  });

  it('should format without axis prefix when neither index provided', () => {
    const input: CellTitleInput = {
      modelLabel: 'llama3',
      phrase: 'Hello world',
    };

    expect(formatCellTitle(input)).toBe('llama3 – Hello world');
  });

  it('should handle empty phrase with both axis IDs', () => {
    const input: CellTitleInput = {
      modelAxisId: 1,
      promptAxisId: 1,
      modelLabel: 'gpt-4o',
      phrase: '',
    };

    expect(formatCellTitle(input)).toBe('M1 S1 · gpt-4o');
  });

  it('should handle empty phrase with no axis IDs', () => {
    const input: CellTitleInput = {
      modelLabel: 'gpt-4o',
    };

    expect(formatCellTitle(input)).toBe('gpt-4o');
  });

  it('should handle missing model label with axis IDs', () => {
    const input: CellTitleInput = {
      modelAxisId: 2,
      promptAxisId: 3,
      phrase: 'Test prompt',
    };

    expect(formatCellTitle(input)).toBe('M2 S3 – Test prompt');
  });

  it('should return Untitled when all inputs are absent', () => {
    expect(formatCellTitle({})).toBe('Untitled');
  });

  it('should truncate long phrases at PHRASE_MAX_LENGTH with ellipsis', () => {
    const longPhrase = 'a'.repeat(60);
    const input: CellTitleInput = {
      modelAxisId: 1,
      modelLabel: 'gpt-4o',
      phrase: longPhrase,
    };

    const result = formatCellTitle(input);
    expect(result).toBe(`M1 · gpt-4o – ${'a'.repeat(48)}…`);
  });

  it('should handle only prompt axis ID without model axis', () => {
    const input: CellTitleInput = {
      promptAxisId: 2,
      modelLabel: 'gemini-pro',
      phrase: 'Summarize',
    };

    expect(formatCellTitle(input)).toBe('S2 · gemini-pro – Summarize');
  });
});
