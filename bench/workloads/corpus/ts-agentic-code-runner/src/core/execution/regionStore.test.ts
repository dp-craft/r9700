import { describe, expect, it } from 'vitest';

import { createRegionStore } from './regionStore';

describe('createRegionStore', () => {
  it('should return the recorded region when get is called for that path', () => {
    // Arrange
    const store = createRegionStore();
    store.record('src/a.ts', { startLine: 3, endLine: 9 });

    // Act
    const region = store.get('src/a.ts');

    // Assert
    expect(region).toEqual({ startLine: 3, endLine: 9 });
  });

  it('should return null when no region was recorded for the path', () => {
    // Arrange
    const store = createRegionStore();

    // Act
    const region = store.get('src/missing.ts');

    // Assert
    expect(region).toBeNull();
  });

  it('should overwrite the prior region when record is called again for the same path', () => {
    // Arrange
    const store = createRegionStore();
    store.record('src/a.ts', { startLine: 1, endLine: 2 });

    // Act
    store.record('src/a.ts', { startLine: 1, endLine: 5 });

    // Assert
    expect(store.get('src/a.ts')).toEqual({ startLine: 1, endLine: 5 });
  });

  it('should return null after clear removes a previously recorded region', () => {
    // Arrange
    const store = createRegionStore();
    store.record('src/a.ts', { startLine: 3, endLine: 9 });

    // Act
    store.clear('src/a.ts');

    // Assert
    expect(store.get('src/a.ts')).toBeNull();
  });
});
