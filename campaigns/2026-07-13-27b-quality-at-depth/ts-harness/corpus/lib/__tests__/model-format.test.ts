import { describe, expect, it } from 'vitest';

import {
  formatContextLength,
  formatPricing,
  formatPricingValue,
  getNonTextModalities,
  hasMetadata
} from '@/lib/model-format';
import type { Model, ModelPricing } from '@/services/llm/types';

// -- Builders --

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'test-model',
  name: 'Test Model',
  ...overrides,
});

const createPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  promptPrice: 1,
  completionPrice: 2,
  ...overrides,
});

// -- formatContextLength --

describe('formatContextLength', () => {
  // -- Positive paths --

  it('should return "1M" when context length is exactly 1_000_000', () => {
    const result = formatContextLength(1_000_000);

    expect(result).toBe('1M');
  });

  it('should return "2M" when context length is 2_000_000', () => {
    const result = formatContextLength(2_000_000);

    expect(result).toBe('2M');
  });

  it('should return "128K" when context length is 128_000', () => {
    const result = formatContextLength(128_000);

    expect(result).toBe('128K');
  });

  it('should return "8K" when context length is 8_192', () => {
    const result = formatContextLength(8_192);

    expect(result).toBe('8K');
  });

  it('should return "1K" when context length is exactly 1_000', () => {
    const result = formatContextLength(1_000);

    expect(result).toBe('1K');
  });

  // -- Negative cases --

  it('should return null when context length is 999 (below 1K threshold)', () => {
    const result = formatContextLength(999);

    expect(result).toBeNull();
  });

  it('should return null when context length is 0', () => {
    const result = formatContextLength(0);

    expect(result).toBeNull();
  });

  it('should return null when context length is undefined', () => {
    const result = formatContextLength(undefined);

    expect(result).toBeNull();
  });

  it('should return null when context length is negative', () => {
    const result = formatContextLength(-1);

    expect(result).toBeNull();
  });
});

// -- formatPricing --

describe('formatPricing', () => {
  // -- Positive paths --

  it('should return "free" when both prompt and completion prices are 0', () => {
    const pricing = createPricing({ promptPrice: 0, completionPrice: 0 });

    const result = formatPricing(pricing);

    expect(result).toBe('free');
  });

  it('should return "varies" when prompt price is negative', () => {
    const pricing = createPricing({ promptPrice: -1_000_000, completionPrice: -1_000_000 });

    const result = formatPricing(pricing);

    expect(result).toBe('varies');
  });

  it('should return labeled pricing for integer prompt and completion prices', () => {
    const pricing = createPricing({ promptPrice: 3, completionPrice: 15 });

    const result = formatPricing(pricing);

    expect(result).toBe('$3 in / $15 out per 1M');
  });

  it('should return labeled pricing for decimal prompt and completion prices', () => {
    const pricing = createPricing({ promptPrice: 0.5, completionPrice: 1.5 });

    const result = formatPricing(pricing);

    expect(result).toBe('$0.5 in / $1.5 out per 1M');
  });

  // -- Negative cases --

  it('should return null when pricing is undefined', () => {
    const result = formatPricing(undefined);

    expect(result).toBeNull();
  });
});

// -- formatPricingValue --

describe('formatPricingValue', () => {
  // -- Positive paths --

  it('should return "$0.001" for a small decimal value', () => {
    const result = formatPricingValue(0.001);

    expect(result).toBe('$0.001');
  });

  it('should return "$3" for an integer value without trailing zeros', () => {
    const result = formatPricingValue(3);

    expect(result).toBe('$3');
  });

  it('should strip trailing zeros from decimal values', () => {
    const result = formatPricingValue(10.5);

    expect(result).toMatch(/^\$10\.5?0?$/);
  });

  // -- Edge cases --

  it('should return "$0" for a zero value', () => {
    const result = formatPricingValue(0);

    expect(result).toBe('$0');
  });
});

// -- hasMetadata --

describe('hasMetadata', () => {
  // -- Positive paths --

  it('should return true when model has a description', () => {
    const model = createModel({ description: 'A capable model' });

    const result = hasMetadata(model);

    expect(result).toBe(true);
  });

  it('should return true when model has a contextLength', () => {
    const model = createModel({ contextLength: 128_000 });

    const result = hasMetadata(model);

    expect(result).toBe(true);
  });

  it('should return true when model has non-text input modalities', () => {
    const model = createModel({ inputModalities: ['text', 'image'] });

    const result = hasMetadata(model);

    expect(result).toBe(true);
  });

  // -- Negative cases --

  it('should return false when model has only id and name', () => {
    const model = createModel();

    const result = hasMetadata(model);

    expect(result).toBe(false);
  });

  it('should return false when model inputModalities contains only "text"', () => {
    const model = createModel({ inputModalities: ['text'] });

    const result = hasMetadata(model);

    expect(result).toBe(false);
  });

  // -- Edge cases --

  it('should return false when model has an empty inputModalities array', () => {
    const model = createModel({ inputModalities: [] });

    const result = hasMetadata(model);

    expect(result).toBe(false);
  });
});

// -- getNonTextModalities --

describe('getNonTextModalities', () => {
  // -- Positive paths --

  it('should return non-text modalities when inputModalities contains mixed types', () => {
    const model = createModel({ inputModalities: ['text', 'image', 'audio'] });

    const result = getNonTextModalities(model);

    expect(result).toEqual(['image', 'audio']);
  });

  // -- Negative cases --

  it('should return empty array when inputModalities contains only "text"', () => {
    const model = createModel({ inputModalities: ['text'] });

    const result = getNonTextModalities(model);

    expect(result).toEqual([]);
  });

  // -- Edge cases --

  it('should return empty array when inputModalities is undefined', () => {
    const model = createModel({ inputModalities: undefined });

    const result = getNonTextModalities(model);

    expect(result).toEqual([]);
  });

  it('should return empty array when inputModalities is an empty array', () => {
    const model = createModel({ inputModalities: [] });

    const result = getNonTextModalities(model);

    expect(result).toEqual([]);
  });
});
