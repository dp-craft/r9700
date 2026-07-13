import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeNamedEntityCount } from '../named-entities';

const sourcePath: string = path.resolve(process.cwd(), 'src/lib/named-entities.ts');
const source: string = readFileSync(sourcePath, 'utf-8');

describe('computeNamedEntityCount', () => {
  it('should load compromise via dynamic import when source is inspected', () => {
    expect(source).toMatch(/import\(\s*['"]compromise['"]\s*\)/);
  });

  it('should not statically import compromise when source is inspected', () => {
    expect(source).not.toMatch(/^\s*import\s+[^()]*from\s+['"]compromise['"]/m);
  });

  it('should count distinct named entities across people, places and orgs when text has entities', async () => {
    const count: number | null = await computeNamedEntityCount(
      'Barack Obama visited Paris with Google'
    );
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('should resolve 0 when text is empty', async () => {
    const count: number | null = await computeNamedEntityCount('');
    expect(count).toBe(0);
  });

  it('should resolve 0 when text is whitespace only', async () => {
    const count: number | null = await computeNamedEntityCount('   \n\t ');
    expect(count).toBe(0);
  });

  it('should resolve 0 when plain text has no named entities', async () => {
    const count: number | null = await computeNamedEntityCount('the cat sat on the mat');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Graceful-degradation branches (timeout + dynamic-import error)
// Each test reloads the module fresh (vi.resetModules + vi.doMock) so mocks
// never leak into the real-compromise tests above.
// ---------------------------------------------------------------------------

type NamedEntitiesModule = typeof import('../named-entities');

describe('computeNamedEntityCount — graceful degradation: timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('should resolve null when the compromise import hangs past the timeout', async () => {
    vi.useFakeTimers();
    // Register a mock for compromise that never resolves before resetting modules
    vi.doMock('compromise', () => new Promise<never>(() => {}));
    vi.resetModules();
    // Re-register after reset so the fresh module sees it
    vi.doMock('compromise', () => new Promise<never>(() => {}));
    const { computeNamedEntityCount: fresh } = (await import(
      '../named-entities'
    )) as NamedEntitiesModule;

    const resultPromise = fresh('Barack Obama visited Paris');
    // Advance past NAMED_ENTITY_COUNT_TIMEOUT_MS (3000 ms)
    await vi.advanceTimersByTimeAsync(3100);
    const result = await resultPromise;

    expect(result).toBeNull();
  });
});

describe('computeNamedEntityCount — graceful degradation: dynamic-import error', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('should resolve null when the compromise dynamic import throws', async () => {
    vi.resetModules();
    vi.doMock('compromise', () => {
      throw new Error('module load failed');
    });
    const { computeNamedEntityCount: fresh } = (await import(
      '../named-entities'
    )) as NamedEntitiesModule;

    const result = await fresh('Barack Obama visited Paris');

    expect(result).toBeNull();
  });
});
