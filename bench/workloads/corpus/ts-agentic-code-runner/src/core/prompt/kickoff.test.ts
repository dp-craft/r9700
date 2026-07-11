import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRegionStore, type SymbolSlice, type TaskSpec } from '../execution';
import {
  buildImplPreloadWithSliceContract,
  CLOSED_LOOP_RUBRIC,
  selectCodeKickoff,
  SLICE_KICKOFF_CONTRACT
} from './kickoff';

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeReader =
  (files: Record<string, string | null>) =>
    async (path: string): Promise<string | null> =>
      path in files ? files[path] : null;

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'nav/T001.json',
  targetFiles: ['src/target.ts'],
  existingTests: [],
  ...overrides,
});

const NAV = 'nav/T001.json';
const TARGET = 'src/target.ts';
const bundleJson = JSON.stringify({ apiContracts: [{ name: 'runEvalComparison' }] });
const largeTarget = ['export const useStore = 1;', 'a', 'b', 'c', 'd'].join('\n');
const sliceOk = (): SymbolSlice => ({
  startLine: 4,
  endLine: 7,
  text: 'runEvalComparison: async () => {}',
});

// ─── closed-loop rubric (4.4b) ────────────────────────────────────────────────

describe('selectCodeKickoff closed-loop rubric', () => {
  it('should embed the closed-loop rubric in the plain code kickoff', () => {
    expect(selectCodeKickoff('impl')).toContain(CLOSED_LOOP_RUBRIC);
  });

  it('should embed the closed-loop rubric in the tdd impl kickoff', () => {
    expect(selectCodeKickoff('tdd')).toContain(CLOSED_LOOP_RUBRIC);
  });

  it('should end the rubric with an explicit DONE halt condition', () => {
    expect(CLOSED_LOOP_RUBRIC).toMatch(/DONE/);
  });

  it('should present the rubric as a numbered step list', () => {
    expect(CLOSED_LOOP_RUBRIC).toMatch(/\(1\)/);
  });

  it('should keep the slice contract free of the closed-loop rubric', () => {
    expect(SLICE_KICKOFF_CONTRACT).not.toContain(CLOSED_LOOP_RUBRIC);
  });
});

// ─── buildImplPreloadWithSliceContract (3.4) ──────────────────────────────────

describe('buildImplPreloadWithSliceContract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should append the slice contract when the slice branch records a region', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();

    // Act
    const result = await buildImplPreloadWithSliceContract(spec, read, {
      regionStore: store,
      slice: sliceOk,
    });

    // Assert
    expect(result).toContain(SLICE_KICKOFF_CONTRACT);
    expect(result).toContain('submit_region');
  });

  it('should place the slice contract after the sliced region text', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();

    // Act
    const result = await buildImplPreloadWithSliceContract(spec, read, {
      regionStore: store,
      slice: sliceOk,
    });

    // Assert
    expect(result.indexOf('lines 4-7')).toBeLessThan(result.indexOf(SLICE_KICKOFF_CONTRACT));
  });

  it('should NOT append the slice contract when no slice resolves (full-source fallback)', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });
    const store = createRegionStore();

    // Act
    const result = await buildImplPreloadWithSliceContract(spec, read, {
      regionStore: store,
      slice: (): null => null,
    });

    // Assert
    expect(result).toContain('Full current source');
    expect(result).not.toContain(SLICE_KICKOFF_CONTRACT);
  });

  it('should NOT append the slice contract when no regionStore is provided', async () => {
    // Arrange
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '3');
    const spec = makeSpec({ targetFiles: [TARGET], navBundlePath: NAV });
    const read = makeReader({ [TARGET]: largeTarget, [NAV]: bundleJson });

    // Act
    const result = await buildImplPreloadWithSliceContract(spec, read, {});

    // Assert
    expect(result).not.toContain(SLICE_KICKOFF_CONTRACT);
  });
});
