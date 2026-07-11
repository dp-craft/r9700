import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildEditRegionDirective,
  type FileReader,
  resolveLargeFileLines
} from '../editRegion';
import type { TaskSpec } from '../executor';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'nav.json',
  targetFiles: ['src/foo.ts'],
  ...overrides,
});

const makeReader =
  (files: Record<string, string>): FileReader =>
    async (path: string): Promise<string | null> =>
      files[path] ?? null;

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

// ─── resolveLargeFileLines ───────────────────────────────────────────────────

describe('resolveLargeFileLines', () => {
  afterEach(() => {
    delete process.env.RUNNER_LARGE_FILE_LINES;
  });

  it('should return 300 when env var is not set', () => {
    delete process.env.RUNNER_LARGE_FILE_LINES;
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should return the parsed value when env var is a valid number', () => {
    process.env.RUNNER_LARGE_FILE_LINES = '500';
    expect(resolveLargeFileLines()).toBe(500);
  });

  it('should return default 300 when env var is NaN', () => {
    process.env.RUNNER_LARGE_FILE_LINES = 'not-a-number';
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should return default 300 when env var is an empty string (Number("") === 0 must not win)', () => {
    delete process.env.RUNNER_MAX_WHOLE_WRITE_LINES;
    process.env.RUNNER_LARGE_FILE_LINES = '';
    expect(resolveLargeFileLines()).toBe(300);
  });
});

// ─── buildEditRegionDirective — no large files ───────────────────────────────

describe('buildEditRegionDirective — small files', () => {
  it('should return empty string when target file is below threshold', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(10) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toBe('');
  });

  it('should return empty string when target file is missing (new file path)', async () => {
    const reader = makeReader({});
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toBe('');
  });

  it('should return empty string when all files are exactly one line below threshold', async () => {
    process.env.RUNNER_LARGE_FILE_LINES = '10';
    const reader = makeReader({ 'src/foo.ts': lines(9) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toBe('');
    delete process.env.RUNNER_LARGE_FILE_LINES;
  });
});

// ─── buildEditRegionDirective — large files ───────────────────────────────────

describe('buildEditRegionDirective — large files', () => {
  beforeEach(() => {
    process.env.RUNNER_LARGE_FILE_LINES = '10';
  });
  afterEach(() => {
    delete process.env.RUNNER_LARGE_FILE_LINES;
  });

  it('should return non-empty string when a target file meets the threshold', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(10) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should include the file path and line count in the directive', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('15 lines');
  });

  it('should instruct to use the edit tool with unique anchor', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('edit tool');
    expect(result).toContain('unique anchor');
  });

  it('should instruct to NOT use the write tool', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('Do NOT use the write tool');
  });

  it('should list existing top-level export names from the file', async () => {
    const fileText = [
      ...Array.from({ length: 10 }, (_, i) => `// filler line ${i}`),
      'export const myFunc = () => {};',
      'export type MyType = string;',
    ].join('\n');
    const reader = makeReader({ 'src/foo.ts': fileText });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('myFunc');
    expect(result).toContain('MyType');
  });

  it('should include do not duplicate or remove text for existing exports', async () => {
    const fileText = [
      ...Array.from({ length: 10 }, (_, i) => `// filler ${i}`),
      'export const fn = () => {};',
    ].join('\n');
    const reader = makeReader({ 'src/foo.ts': fileText });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('do not duplicate or remove');
  });

  it('should note no exports when file has no top-level export declarations', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('No top-level exports detected');
  });

  it('should instruct to implement exactly what the failing test requires', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('failing test requires');
  });

  it('should include the Large-file edit guidance header', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('Large-file edit guidance');
  });
});

// ─── buildEditRegionDirective — nav bundle apiContracts ──────────────────────

describe('buildEditRegionDirective — nav bundle surface', () => {
  beforeEach(() => {
    process.env.RUNNER_LARGE_FILE_LINES = '10';
  });
  afterEach(() => {
    delete process.env.RUNNER_LARGE_FILE_LINES;
  });

  it('should list apiContract names as surface to add when bundle has them', async () => {
    const bundle = JSON.stringify({
      apiContracts: [{ name: 'useFoo' }, { name: 'FooState' }],
    });
    const reader = makeReader({ 'src/foo.ts': lines(15), 'nav.json': bundle });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).toContain('useFoo');
    expect(result).toContain('FooState');
    expect(result).toContain('New or changed surface to add');
  });

  it('should omit the surface line when bundle has no apiContracts', async () => {
    const bundle = JSON.stringify({});
    const reader = makeReader({ 'src/foo.ts': lines(15), 'nav.json': bundle });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).not.toContain('New or changed surface to add');
  });

  it('should omit the surface line when nav bundle is missing', async () => {
    const reader = makeReader({ 'src/foo.ts': lines(15) });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).not.toContain('New or changed surface to add');
  });

  it('should omit the surface line when bundle apiContracts have no name field', async () => {
    const bundle = JSON.stringify({ apiContracts: [{ signature: 'foo(): void' }] });
    const reader = makeReader({ 'src/foo.ts': lines(15), 'nav.json': bundle });
    const result = await buildEditRegionDirective(makeSpec(), reader);
    expect(result).not.toContain('New or changed surface to add');
  });
});

// ─── buildEditRegionDirective — multiple target files ────────────────────────

describe('buildEditRegionDirective — multiple target files', () => {
  beforeEach(() => {
    process.env.RUNNER_LARGE_FILE_LINES = '10';
  });
  afterEach(() => {
    delete process.env.RUNNER_LARGE_FILE_LINES;
  });

  it('should emit a paragraph for each large file', async () => {
    const reader = makeReader({
      'src/foo.ts': lines(15),
      'src/bar.ts': lines(20),
    });
    const spec = makeSpec({ targetFiles: ['src/foo.ts', 'src/bar.ts'] });
    const result = await buildEditRegionDirective(spec, reader);
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('src/bar.ts');
  });

  it('should skip small files and only emit for large ones', async () => {
    const reader = makeReader({
      'src/foo.ts': lines(5),
      'src/bar.ts': lines(20),
    });
    const spec = makeSpec({ targetFiles: ['src/foo.ts', 'src/bar.ts'] });
    const result = await buildEditRegionDirective(spec, reader);
    expect(result).not.toContain('src/foo.ts');
    expect(result).toContain('src/bar.ts');
  });
});
