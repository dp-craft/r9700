import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getProxyUrl } from '@/lib/proxy-url';

vi.mock('@/lib/platform', () => ({
  isElectron: vi.fn(),
  getProxyBaseUrl: vi.fn(),
}));

import { getProxyBaseUrl, isElectron } from '@/lib/platform';

const mockIsElectron = vi.mocked(isElectron);
const mockGetProxyBaseUrl = vi.mocked(getProxyBaseUrl);

// ===========================================================================
// getProxyUrl
// ===========================================================================

describe('getProxyUrl', () => {
  // -- browser (non-Electron) --

  describe('when not in Electron (browser)', () => {
    beforeEach(() => {
      mockIsElectron.mockReturnValue(false);
      mockGetProxyBaseUrl.mockReturnValue(null);
    });

    it('should return the original URL unchanged', () => {
      // Given
      const originalUrl = 'https://api.openai.com/v1/chat/completions';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toBe(originalUrl);
    });

    it('should return the original URL unchanged when URL has query parameters', () => {
      // Given
      const originalUrl = 'https://api.example.com/v1/models?limit=10&page=2';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toBe(originalUrl);
    });

    it('should return the original URL unchanged when URL has special characters', () => {
      // Given
      const originalUrl = 'https://api.example.com/v1/search?q=hello+world&filter=a%3Db';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toBe(originalUrl);
    });
  });

  // -- Electron --

  describe('when in Electron', () => {
    const proxyBase = 'http://127.0.0.1:12345';

    beforeEach(() => {
      mockIsElectron.mockReturnValue(true);
      mockGetProxyBaseUrl.mockReturnValue(proxyBase);
    });

    it('should return proxy URL with encoded target for a plain URL', () => {
      // Given
      const originalUrl = 'https://api.openai.com/v1/chat/completions';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toBe(`http://127.0.0.1:12345/proxy?target=${encodeURIComponent(originalUrl)}`);
    });

    it('should properly encode special characters in the target URL', () => {
      // Given — URL with characters that need percent-encoding
      const originalUrl = 'https://api.example.com/v1/path?key=value&other=a+b';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toBe(`http://127.0.0.1:12345/proxy?target=${encodeURIComponent(originalUrl)}`);
    });

    it('should handle URLs with existing query parameters correctly', () => {
      // Given — URL that itself contains a query string with an = and & characters
      const originalUrl =
        'https://api.openrouter.ai/api/v1/chat/completions?stream=true&format=json';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      const expectedTarget = encodeURIComponent(originalUrl);
      expect(result).toBe(`http://127.0.0.1:12345/proxy?target=${expectedTarget}`);
      // The target param must not contain raw & or = from the original URL
      const parsedTarget = new URL(result).searchParams.get('target');
      expect(parsedTarget).toBe(originalUrl);
    });

    it('should include the correct proxy port from getProxyBaseUrl', () => {
      // Given — verify port is taken from getProxyBaseUrl, not hardcoded
      mockGetProxyBaseUrl.mockReturnValue('http://127.0.0.1:9999');
      const originalUrl = 'https://api.example.com/v1/models';

      // When
      const result = getProxyUrl(originalUrl);

      // Then
      expect(result).toMatch(/^http:\/\/127\.0\.0\.1:9999\/proxy\?target=/);
    });
  });
});
