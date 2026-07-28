import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProxyBaseUrl, isElectron } from '@/lib/platform';

const mockElectronAPI = (proxyPort: number) => ({ proxyPort }) as unknown as IElectronAPI;

// -- isElectron --

describe('isElectron', () => {
  beforeEach(() => {
    window.electronAPI = undefined;
  });

  afterEach(() => {
    window.electronAPI = undefined;
  });

  // -- Positive path: Electron environment --

  it('should return true when window.electronAPI is present', () => {
    // Given
    window.electronAPI = mockElectronAPI(12345);

    // When
    const result = isElectron();

    // Then
    expect(result).toBe(true);
  });

  // -- Negative case: browser environment --

  it('should return false when window.electronAPI is undefined', () => {
    // Given — window.electronAPI is undefined in beforeEach

    // When
    const result = isElectron();

    // Then
    expect(result).toBe(false);
  });

  // -- Edge case: electronAPI explicitly set to undefined --

  it('should return false when window.electronAPI is explicitly undefined', () => {
    // Given
    window.electronAPI = undefined;

    // When
    const result = isElectron();

    // Then
    expect(result).toBe(false);
  });
});

// -- getProxyBaseUrl --

describe('getProxyBaseUrl', () => {
  beforeEach(() => {
    window.electronAPI = undefined;
  });

  afterEach(() => {
    window.electronAPI = undefined;
  });

  // -- Positive path: Electron with proxyPort --

  it('should return http://127.0.0.1:{port} when window.electronAPI.proxyPort is set', () => {
    // Given
    window.electronAPI = mockElectronAPI(12345);

    // When
    const result = getProxyBaseUrl();

    // Then
    expect(result).toBe('http://127.0.0.1:12345');
  });

  // -- Negative case: browser environment --

  it('should return null when not in Electron', () => {
    // Given — window.electronAPI is undefined in beforeEach

    // When
    const result = getProxyBaseUrl();

    // Then
    expect(result).toBeNull();
  });

  // -- State transition: port value is reflected in URL --

  it('should include the exact port number in the returned URL', () => {
    // Given
    window.electronAPI = mockElectronAPI(9999);

    // When
    const result = getProxyBaseUrl();

    // Then
    expect(result).toBe('http://127.0.0.1:9999');
  });

  // -- Edge case: port 0 (boundary value) --

  it('should return http://127.0.0.1:0 when proxyPort is 0', () => {
    // Given
    window.electronAPI = mockElectronAPI(0);

    // When
    const result = getProxyBaseUrl();

    // Then
    expect(result).toBe('http://127.0.0.1:0');
  });
});
