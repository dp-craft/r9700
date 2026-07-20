import { describe, expect, it } from 'vitest';

import { buildThinkingOptions, THINKING_BUDGET_REQUIRED_PROVIDERS } from '../thinking-options';

describe('THINKING_BUDGET_REQUIRED_PROVIDERS', () => {
  it('should contain claude and gemini', () => {
    expect(THINKING_BUDGET_REQUIRED_PROVIDERS.has('claude')).toBe(true);
    expect(THINKING_BUDGET_REQUIRED_PROVIDERS.has('gemini')).toBe(true);
    expect(THINKING_BUDGET_REQUIRED_PROVIDERS.size).toBe(2);
  });

  it('should not contain budget-free providers', () => {
    expect(THINKING_BUDGET_REQUIRED_PROVIDERS.has('ollama')).toBe(false);
    expect(THINKING_BUDGET_REQUIRED_PROVIDERS.has('unsloth')).toBe(false);
  });
});

describe('buildThinkingOptions', () => {
  it('should return empty object when thinkingEnabled is undefined', () => {
    const result = buildThinkingOptions('ollama', undefined);
    expect(result).toEqual({});
  });

  it('should return empty object when thinkingEnabled is false', () => {
    const result = buildThinkingOptions('ollama', false);
    expect(result).toEqual({});
  });

  it('should return thinkingEnabled only for budget-free provider', () => {
    const result = buildThinkingOptions('ollama', true);
    expect(result).toEqual({ thinkingEnabled: true });
  });

  it('should return thinkingEnabled and thinkingBudget when budget supplied to budget-required provider', () => {
    const result = buildThinkingOptions('claude', true, 2048);
    expect(result).toEqual({ thinkingEnabled: true, thinkingBudget: 2048 });
  });

  it('should return empty object when budget-required provider has no budget (M3b gate)', () => {
    const result = buildThinkingOptions('claude', true);
    expect(result).toEqual({});
  });

  it('should return empty object for gemini without budget (M3b gate)', () => {
    const result = buildThinkingOptions('gemini', true);
    expect(result).toEqual({});
  });

  it('should return thinkingEnabled only for unsloth (budget-free)', () => {
    const result = buildThinkingOptions('unsloth', true);
    expect(result).toEqual({ thinkingEnabled: true });
  });
});
