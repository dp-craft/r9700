import '@testing-library/jest-dom';

import { beforeEach } from 'vitest';

// Set English locale for all tests so translated strings match English expectations.
// Uses dynamic import to avoid pulling in IDB modules at setup time.
// Guarded: some tests mock the settings module, so setState may not exist.
beforeEach(async () => {
  try {
    const { useSettingsStore } = await import('@/features/settings');
    if (typeof useSettingsStore?.setState === 'function') {
      useSettingsStore.setState({ uiLanguage: 'en' });
    }
  } catch {
    // Settings module not available in this test context
  }
});

// Polyfill ResizeObserver for Radix UI ScrollArea in jsdom
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// Polyfill pointer capture and scrollIntoView for Radix UI components in jsdom
// Guarded: Element is not defined in Node environment (electron tests)
if (typeof globalThis.Element !== 'undefined') {
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
}

// Mock IDBKeyRange for IndexedDB tests
class MockIDBKeyRange {
  readonly lower: unknown;
  readonly upper: unknown;
  readonly lowerOpen: boolean;
  readonly upperOpen: boolean;

  constructor(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  static bound(
    lower: unknown,
    upper: unknown,
    lowerOpen = false,
    upperOpen = false
  ): MockIDBKeyRange {
    return new MockIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  static only(value: unknown): MockIDBKeyRange {
    return new MockIDBKeyRange(value, value, false, false);
  }

  static lowerBound(lower: unknown, open = false): MockIDBKeyRange {
    return new MockIDBKeyRange(lower, undefined, open, true);
  }

  static upperBound(upper: unknown, open = false): MockIDBKeyRange {
    return new MockIDBKeyRange(undefined, upper, true, open);
  }

  includes(): boolean {
    return true;
  }
}

globalThis.IDBKeyRange = MockIDBKeyRange as unknown as typeof IDBKeyRange;
