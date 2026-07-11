import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavLocation, TsMorphNav } from '../../../../lib/tsMorphNav';
import { __resetNavCacheForTests, lspTool, type NavBundleLookup, tsconfigForFile } from './lsp';

beforeEach(() => {
  __resetNavCacheForTests();
});

const loc = (file: string, line: number, column: number): NavLocation => ({ file, line, column });

const fakeNav = (overrides: Partial<TsMorphNav> = {}): TsMorphNav => ({
  definition: () => [],
  references: () => [],
  hover: () => null,
  implementation: () => [],
  ...overrides,
});

const bundleWith = (answer: string | null): NavBundleLookup => ({ find: () => answer });

describe('lspTool', () => {
  it('should return the bundled answer and not start ts-morph when the nav bundle has a hit', async () => {
    const factory = vi.fn<(tsconfig: string) => TsMorphNav>(() => fakeNav());

    const result = await lspTool(
      bundleWith('Greeter (interface)'),
      {
        op: 'hover',
        symbol: 'Greeter',
      },
      factory
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Greeter (interface)');
    expect(factory).not.toHaveBeenCalled();
  });

  it('should delegate to ts-morph on a bundle miss and return the live answer', async () => {
    const factory = vi.fn<(tsconfig: string) => TsMorphNav>(() =>
      fakeNav({ hover: () => 'string' })
    );

    const result = await lspTool(bundleWith(null), { op: 'hover', symbol: 'name' }, factory);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('string');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should create ts-morph lazily only once across repeated misses', async () => {
    const factory = vi.fn<(tsconfig: string) => TsMorphNav>(() =>
      fakeNav({ hover: () => 'string' })
    );
    const bundle = bundleWith(null);

    await lspTool(bundle, { op: 'hover', symbol: 'a' }, factory);
    await lspTool(bundle, { op: 'hover', symbol: 'b' }, factory);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('should return at least one location for a references op on a miss', async () => {
    const factory = (): TsMorphNav =>
      fakeNav({ references: () => [loc('/x/a.ts', 3, 5), loc('/x/b.ts', 9, 1)] });

    const result = await lspTool(bundleWith(null), { op: 'references', symbol: 'foo' }, factory);

    expect(result.ok).toBe(true);
    expect(result.output).toContain('/x/a.ts');
    expect(result.output.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it('should return ok=false when the symbol is unresolved on a miss', async () => {
    const factory = (): TsMorphNav => fakeNav();

    const result = await lspTool(
      bundleWith(null),
      { op: 'definition', symbol: 'missing' },
      factory
    );

    expect(result.ok).toBe(false);
  });

  it('should build the live nav with tsconfig.app.json for a src/ query on a miss', async () => {
    const factory = vi.fn<(tsconfig: string) => TsMorphNav>(() =>
      fakeNav({ hover: () => 'string' })
    );

    await lspTool(bundleWith(null), { op: 'hover', symbol: 'X', file: 'src/db/idb.ts' }, factory);

    expect(factory).toHaveBeenCalledWith('tsconfig.app.json');
  });

  it('should build the live nav with tsconfig.scripts.json for a tools/ query on a miss', async () => {
    const factory = vi.fn<(tsconfig: string) => TsMorphNav>(() =>
      fakeNav({ hover: () => 'string' })
    );

    await lspTool(bundleWith(null), { op: 'hover', symbol: 'Y', file: 'tools/x.ts' }, factory);

    expect(factory).toHaveBeenCalledWith('tsconfig.scripts.json');
  });
});

describe('tsconfigForFile', () => {
  it('should select tsconfig.app.json for a src/ file', () => {
    expect(tsconfigForFile('src/db/idb.ts')).toBe('tsconfig.app.json');
  });

  it('should select tsconfig.scripts.json for a tools/ file', () => {
    expect(tsconfigForFile('tools/agentic-code-runner/src/runner.ts')).toBe(
      'tsconfig.scripts.json'
    );
  });

  it('should default to tsconfig.app.json when file is undefined', () => {
    expect(tsconfigForFile(undefined)).toBe('tsconfig.app.json');
  });
});
