import { describe, expect, it } from 'vitest';

import { getVisibleProviderOrder, PROVIDER_META, PROVIDER_ORDER } from '../provider-meta';
import type { ProviderKey } from '../types';

describe('PROVIDER_META.unsloth', () => {
  it('should declare native CORS support', () => {
    expect(PROVIDER_META.unsloth.corsSupport).toBe('native');
  });

  it('should expose only a baseUrl field', () => {
    expect(PROVIDER_META.unsloth.fields).toEqual(['baseUrl']);
  });

  it('should default the base URL to the local OpenAI-compatible endpoint', () => {
    expect(PROVIDER_META.unsloth.defaultBaseUrl).toBe('http://localhost:8000/v1');
  });
});

describe('PROVIDER_ORDER', () => {
  it('should contain unsloth', () => {
    expect(PROVIDER_ORDER).toContain('unsloth');
  });
});

describe('getVisibleProviderOrder', () => {
  describe('positive paths', () => {
    it('should return all providers except browser when showCorsProviders is true and labPerplexityEnabled is false', () => {
      const result = getVisibleProviderOrder(true);

      expect(result).toEqual([
        'ollama',
        'openrouter',
        'chatgpt',
        'claude',
        'kimi',
        'perplexity',
        'gemini',
        'copilot',
        'unsloth',
      ]);
    });

    it('should return only native CORS providers when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).toEqual(['ollama', 'openrouter', 'gemini', 'unsloth']);
    });

    it('should include unsloth even when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).toContain('unsloth');
    });

    it('should return the same reference as PROVIDER_ORDER when showCorsProviders is true and labPerplexityEnabled is true', () => {
      const result = getVisibleProviderOrder(true, true);

      expect(result).toBe(PROVIDER_ORDER);
    });
  });

  describe('order preservation', () => {
    it('should preserve PROVIDER_ORDER ordering when showCorsProviders is true', () => {
      const result = getVisibleProviderOrder(true);

      const providerOrderIndexes = result.map(key => PROVIDER_ORDER.indexOf(key));
      const isSorted = providerOrderIndexes.every((val, i, arr) => i === 0 || arr[i - 1] < val);

      expect(isSorted).toBe(true);
    });

    it('should preserve PROVIDER_ORDER ordering when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      const providerOrderIndexes = result.map(key => PROVIDER_ORDER.indexOf(key));
      const isSorted = providerOrderIndexes.every((val, i, arr) => i === 0 || arr[i - 1] < val);

      expect(isSorted).toBe(true);
    });

    it('should place ollama before openrouter before gemini when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result.indexOf('ollama' as ProviderKey)).toBeLessThan(
        result.indexOf('openrouter' as ProviderKey)
      );
      expect(result.indexOf('openrouter' as ProviderKey)).toBeLessThan(
        result.indexOf('gemini' as ProviderKey)
      );
    });
  });

  describe('filtering correctness', () => {
    it('should exclude chatgpt when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).not.toContain('chatgpt');
    });

    it('should exclude claude when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).not.toContain('claude');
    });

    it('should exclude kimi when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).not.toContain('kimi');
    });

    it('should exclude perplexity when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).not.toContain('perplexity');
    });

    it('should exclude copilot when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).not.toContain('copilot');
    });

    it('should include chatgpt when showCorsProviders is true', () => {
      const result = getVisibleProviderOrder(true);

      expect(result).toContain('chatgpt');
    });

    it('should include claude when showCorsProviders is true', () => {
      const result = getVisibleProviderOrder(true);

      expect(result).toContain('claude');
    });
  });

  describe('return type', () => {
    it('should return a readonly array', () => {
      const result = getVisibleProviderOrder(true);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should return exactly 9 providers when showCorsProviders is true and labPerplexityEnabled is false', () => {
      const result = getVisibleProviderOrder(true);

      expect(result).toHaveLength(9);
    });

    it('should return exactly 4 providers when showCorsProviders is false and labPerplexityEnabled is false', () => {
      const result = getVisibleProviderOrder(false);

      expect(result).toHaveLength(4);
    });

    it('should contain only valid ProviderKey values when showCorsProviders is true', () => {
      const validKeys: readonly ProviderKey[] = [
        'ollama',
        'openrouter',
        'chatgpt',
        'claude',
        'kimi',
        'perplexity',
        'gemini',
        'copilot',
        'unsloth',
        'browser',
      ];

      const result = getVisibleProviderOrder(true, true);

      result.forEach(key => {
        expect(validKeys).toContain(key);
      });
    });

    it('should contain only valid ProviderKey values when showCorsProviders is false', () => {
      const validKeys: readonly ProviderKey[] = [
        'ollama',
        'openrouter',
        'chatgpt',
        'claude',
        'kimi',
        'perplexity',
        'gemini',
        'copilot',
        'unsloth',
        'browser',
      ];

      const result = getVisibleProviderOrder(false);

      result.forEach(key => {
        expect(validKeys).toContain(key);
      });
    });
  });

  describe('determinism', () => {
    it('should return the same result on consecutive calls with showCorsProviders true', () => {
      const first = getVisibleProviderOrder(true);
      const second = getVisibleProviderOrder(true);

      expect(first).toEqual(second);
    });

    it('should return the same result on consecutive calls with showCorsProviders false', () => {
      const first = getVisibleProviderOrder(false);
      const second = getVisibleProviderOrder(false);

      expect(first).toEqual(second);
    });
  });

  describe('edge cases', () => {
    it('should not return duplicate provider keys when showCorsProviders is true', () => {
      const result = getVisibleProviderOrder(true);

      const unique = new Set(result);

      expect(unique.size).toBe(result.length);
    });

    it('should not return duplicate provider keys when showCorsProviders is false', () => {
      const result = getVisibleProviderOrder(false);

      const unique = new Set(result);

      expect(unique.size).toBe(result.length);
    });

    it('should return a subset of the true result when showCorsProviders is false', () => {
      const allProviders = getVisibleProviderOrder(true);
      const filteredProviders = getVisibleProviderOrder(false);

      filteredProviders.forEach(key => {
        expect(allProviders).toContain(key);
      });
    });
  });

  describe('labPerplexityEnabled gating', () => {
    it('should exclude browser when showCorsProviders is true and labPerplexityEnabled is false', () => {
      const result = getVisibleProviderOrder(true, false);

      expect(result).not.toContain('browser');
      expect(result).toHaveLength(9);
    });

    it('should include browser when showCorsProviders is true and labPerplexityEnabled is true', () => {
      const result = getVisibleProviderOrder(true, true);

      expect(result).toContain('browser');
      expect(result).toHaveLength(10);
      expect(result).toBe(PROVIDER_ORDER);
    });

    it('should exclude browser when showCorsProviders is false and labPerplexityEnabled is false', () => {
      const result = getVisibleProviderOrder(false, false);

      expect(result).not.toContain('browser');
      // native-only providers: ollama, openrouter, gemini, unsloth
      expect(result).toHaveLength(4);
    });

    it('should include browser when showCorsProviders is false and labPerplexityEnabled is true', () => {
      const result = getVisibleProviderOrder(false, true);

      expect(result).toContain('browser');
      // native-only providers + browser: ollama, openrouter, gemini, unsloth, browser
      expect(result).toHaveLength(5);
    });
  });
});
