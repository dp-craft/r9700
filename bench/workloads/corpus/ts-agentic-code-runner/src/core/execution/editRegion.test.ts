import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildImplPreload,
  MAX_PRELOAD_FILE_CHARS,
  MAX_TEST_PRELOAD_CHARS,
  MAX_TEST_PRELOAD_LINES,
  TARGET_TAIL_LINES
} from './editRegion';
import type { TaskSpec } from './executor';
import type { SymbolSlice } from './regionSlicer';
import { createRegionStore } from './regionStore';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeReader =
  (files: Record<string, string | null>) =>
    async (path: string): Promise<string | null> =>
      path in files ? files[path] : null;

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'nav/T001.json',
  targetFiles: ['src/target.ts'],
  ...overrides,
});

const makeLines = (count: number, prefix = 'line'): string =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n');

// ─── buildImplPreload ─────────────────────────────────────────────────────────

describe('buildImplPreload', () => {
  it('should return empty string when no existing tests and target unreadable', async () => {
    // Arrange
    const spec = makeSpec({ existingTests: [] });
    const read = makeReader({ 'src/target.ts': null });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toBe('');
  });

  it('should include whole test file when file is at or below MAX_TEST_PRELOAD_LINES', async () => {
    // Arrange
    const testContent = makeLines(MAX_TEST_PRELOAD_LINES);
    const spec = makeSpec({
      existingTests: [{ path: 'src/foo.test.ts', describeItTree: [] }],
      targetFiles: ['src/target.ts'],
    });
    const read = makeReader({ 'src/foo.test.ts': testContent, 'src/target.ts': null });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain(testContent);
    expect(result).toContain('Failing test source');
    expect(result).not.toContain('earlier tests omitted');
  });

  it('should include only tail with omitted-marker when test file exceeds MAX_TEST_PRELOAD_LINES', async () => {
    // Arrange
    const overLimitContent = makeLines(MAX_TEST_PRELOAD_LINES + 1);
    const spec = makeSpec({
      existingTests: [{ path: 'src/foo.test.ts', describeItTree: [] }],
      targetFiles: ['src/target.ts'],
    });
    const read = makeReader({ 'src/foo.test.ts': overLimitContent, 'src/target.ts': null });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain('earlier tests omitted');
    // tail lines present
    expect(result).toContain(`line ${MAX_TEST_PRELOAD_LINES + 1}`);
    // first line NOT present (omitted)
    expect(result).not.toContain('line 1\n');
  });

  it('should inject the full target source when target file is within MAX_PRELOAD_FILE_CHARS', async () => {
    // Arrange
    const targetContent = makeLines(TARGET_TAIL_LINES + 10, 'target-line');
    const spec = makeSpec({ existingTests: [], targetFiles: ['src/target.ts'] });
    const read = makeReader({ 'src/target.ts': targetContent });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain('Full current source of src/target.ts');
    // the whole file is present, including the first line
    expect(result).toContain('target-line 1\n');
    expect(result).toContain(`target-line ${TARGET_TAIL_LINES + 10}`);
    expect(result).not.toContain('Target file tail');
  });

  it('should fall back to the tail anchor when target file exceeds MAX_PRELOAD_FILE_CHARS', async () => {
    // Arrange — a file whose char length exceeds the full-file budget
    const head = 'head-line\n';
    const filler = 'x'.repeat(MAX_PRELOAD_FILE_CHARS);
    const targetContent = `${head}${filler}\ntarget-tail-line`;
    const spec = makeSpec({ existingTests: [], targetFiles: ['src/target.ts'] });
    const read = makeReader({ 'src/target.ts': targetContent });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain('Target file tail');
    expect(result).toContain('target-tail-line');
    expect(result).not.toContain('Full current source');
  });

  it('should clip combined test text at MAX_TEST_PRELOAD_CHARS and append clip marker', async () => {
    // Arrange — single long line repeated to exceed char budget without hitting line limit
    const longLine = 'x'.repeat(100);
    const testContent = Array.from({ length: 5 }, () => longLine).join('\n') + '\n' + 'z'.repeat(MAX_TEST_PRELOAD_CHARS);
    const spec = makeSpec({
      existingTests: [{ path: 'src/foo.test.ts', describeItTree: [] }],
      targetFiles: ['src/target.ts'],
    });
    const read = makeReader({ 'src/foo.test.ts': testContent, 'src/target.ts': null });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain('…[clipped]');
    // content beyond the cap should not appear
    expect(result).not.toContain('z'.repeat(MAX_TEST_PRELOAD_CHARS));
  });
});

// ─── buildImplPreload — slice branch (3.2) ─────────────────────────────────────

describe('buildImplPreload — slice branch (3.2)', () => {
  const NAV = 'nav/T001.json';
  const TARGET = 'src/target.ts';
  const bundleJson = JSON.stringify({ apiContracts: [{ name: 'runEvalComparison' }] });
  const largeTarget = ['export const useStore = 1;', 'a', 'b', 'c', 'd'].join('\n');

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should emit the sliced region + exports and record the region when target is large and a slice resolves', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();
    const slice = (): SymbolSlice => ({
      startLine: 4,
      endLine: 7,
      text: 'runEvalComparison: async () => {}',
    });

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('lines 4-7');
    expect(result).toContain('runEvalComparison: async () => {}');
    expect(result).toContain('useStore');
    expect(result).not.toContain('Full current source');
    expect(store.get(resolve(process.cwd(), TARGET))).toEqual({ startLine: 4, endLine: 7 });
  });

  it('should fall back to full source and record nothing when no slice resolves', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();
    const slice = (): null => null;

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('Full current source of src/target.ts');
    expect(store.get(resolve(process.cwd(), TARGET))).toBeNull();
  });

  it('should fall back to full source when target is below the large-file threshold', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '100');
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();
    const slice = (): SymbolSlice => ({ startLine: 1, endLine: 1, text: 'x' });

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('Full current source');
    expect(store.get(resolve(process.cwd(), TARGET))).toBeNull();
  });

  it('should leave no recorded region when a slice hit is followed by a miss on the same store', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();
    const hit = (): SymbolSlice => ({ startLine: 4, endLine: 7, text: 'runEvalComparison: async () => {}' });
    const miss = (): null => null;

    // Act — attempt 1 slices+records, attempt 2 misses and must clear the stale region
    await buildImplPreload(spec, read, { regionStore: store, slice: hit });
    const second = await buildImplPreload(spec, read, { regionStore: store, slice: miss });

    // Assert
    expect(second).toContain('Full current source of src/target.ts');
    expect(store.get(resolve(process.cwd(), TARGET))).toBeNull();
  });

  it('should fall back to full source when no regionStore is provided', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });

    // Act
    const result = await buildImplPreload(spec, read);

    // Assert
    expect(result).toContain('Full current source');
  });

  it('should use the neighbor anchor with the placement note when the deliverable symbol is absent', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const neighborBundleJson = JSON.stringify({
      apiContracts: [],
      collaborators: { siblingBody: { name: 'sib' } },
    });
    const spec = makeSpec({
      existingTests: [],
      targetFiles: [TARGET],
      navBundlePath: NAV,
      taskStatement: 'Add `newThing(x)` to it',
    });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: neighborBundleJson });
    const store = createRegionStore();
    const slice = (_filePath: string, symbolName: string): SymbolSlice | null =>
      symbolName === 'sib' ? { startLine: 10, endLine: 20, text: 'sib body' } : null;

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('the nearest EXISTING member `sib`');
    expect(result).toContain('lines 10-20');
    expect(store.get(resolve(process.cwd(), TARGET))).toEqual({ startLine: 10, endLine: 20 });
  });

  it('should resolve the parsed deliverable to a symbol slice with no neighbor note when it already exists', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const neighborBundleJson = JSON.stringify({
      apiContracts: [],
      collaborators: { siblingBody: { name: 'sib' } },
    });
    const spec = makeSpec({
      existingTests: [],
      targetFiles: [TARGET],
      navBundlePath: NAV,
      taskStatement: 'Add `newThing(x)` to it',
    });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: neighborBundleJson });
    const store = createRegionStore();
    const slice = (_filePath: string, symbolName: string): SymbolSlice | null => {
      if (symbolName === 'newThing') return { startLine: 4, endLine: 7, text: 'newThing body' };
      if (symbolName === 'sib') return { startLine: 10, endLine: 20, text: 'sib body' };
      return null;
    };

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('lines 4-7');
    expect(result).not.toContain('nearest EXISTING member');
    expect(store.get(resolve(process.cwd(), TARGET))).toEqual({ startLine: 4, endLine: 7 });
  });

  it('should prioritize an apiContracts symbol over the neighbor anchor', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const apiBundleJson = JSON.stringify({
      apiContracts: [{ name: 'api' }],
      collaborators: { siblingBody: { name: 'sib' } },
    });
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: apiBundleJson });
    const store = createRegionStore();
    const slice = (_filePath: string, symbolName: string): SymbolSlice | null =>
      symbolName === 'api' ? { startLine: 2, endLine: 3, text: 'api body' } : null;

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('lines 2-3');
    expect(result).not.toContain('nearest EXISTING member');
    expect(store.get(resolve(process.cwd(), TARGET))).toEqual({ startLine: 2, endLine: 3 });
  });

  it('should fall back to full source and record nothing when neither the deliverable nor the neighbor resolves', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const neighborBundleJson = JSON.stringify({
      apiContracts: [],
      collaborators: { siblingBody: { name: 'sib' } },
    });
    const spec = makeSpec({
      existingTests: [],
      targetFiles: [TARGET],
      navBundlePath: NAV,
      taskStatement: 'Add `newThing(x)`',
    });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: neighborBundleJson });
    const store = createRegionStore();
    const slice = (): null => null;

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('Full current source');
    expect(store.get(resolve(process.cwd(), TARGET))).toBeNull();
  });

  it('should fall back to full source when the bundle has no siblingBody and no deliverable resolves', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const noNeighborBundleJson = JSON.stringify({ apiContracts: [] });
    const spec = makeSpec({ existingTests: [], targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: noNeighborBundleJson });
    const store = createRegionStore();
    const slice = (): null => null;

    // Act
    const result = await buildImplPreload(spec, read, { regionStore: store, slice });

    // Assert
    expect(result).toContain('Full current source');
    expect(store.get(resolve(process.cwd(), TARGET))).toBeNull();
  });
});
