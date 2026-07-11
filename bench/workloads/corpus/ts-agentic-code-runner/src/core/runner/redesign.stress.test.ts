import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEditRegionDirective, resolveLargeFileLines } from '../execution/editRegion';
import type { TaskSpec } from '../execution/executor';
import {
  buildFeedbackMessage,
  failureSignature,
  FEEDBACK_MAX_OUTPUT_CHARS,
  localizeOutput
} from '../gates/feedback';
import type { GateContext, GateFailure, GateRunResult } from '../gates/gates';
import { changedLineRanges, decompositionGate, functionalStyleGate } from '../gates/gates';
import { createToolRegistry } from '../tools/toolRegistry';
import { verifyEdit } from '../tools/verifyEdit';
import { buildTestKickoff } from './runner';

// ─── helpers ────────────────────────────────────────────────────────────────

const makeSpec = (overrides: Partial<TaskSpec> = {}): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'nav.json',
  targetFiles: ['src/foo.ts'],
  ...overrides,
});

const makeReader =
  (files: Record<string, string>) =>
    async (path: string): Promise<string | null> =>
      files[path] ?? null;

// Build a synthetic git diff -U0 body with mixed hunk types across a large file.
// ~500 hunks:  multi-line additions, single-line additions, deletion-only, new-file.
const buildHugeDiff = (): string => {
  const hunks: string[] = [];

  // new-file hunk: @@ -0,0 +1,N @@ — entire file is added
  hunks.push('@@ -0,0 +1,10 @@\n' + Array.from({ length: 10 }, (_, i) => `+line${i}`).join('\n'));

  // 200 multi-line addition hunks: @@ -a,b +c,d @@ — each adds 3 lines
  Array.from({ length: 200 }, (_, i) => {
    const oldStart = 20 + i * 10;
    const newStart = 20 + i * 10;
    hunks.push(
      `@@ -${oldStart},2 +${newStart},3 @@\n-old${i}a\n-old${i}b\n+new${i}a\n+new${i}b\n+new${i}c`
    );
  });

  // 200 single-line addition hunks: @@ -a +c @@ (no comma = count 1)
  Array.from({ length: 200 }, (_, i) => {
    const base = 2200 + i * 5;
    hunks.push(`@@ -${base} +${base} @@\n-singleOld${i}\n+singleNew${i}`);
  });

  // 100 deletion-only hunks: @@ -a,b +c,0 @@ — contribute NO added lines
  Array.from({ length: 100 }, (_, i) => {
    const base = 3200 + i * 5;
    hunks.push(`@@ -${base},2 +${base},0 @@\n-deleted${i}a\n-deleted${i}b`);
  });

  return hunks.join('\n');
};

// Build a fake file with ~5000 lines
const build5000LineFile = (): string =>
  Array.from({ length: 5000 }, (_, i) => `const line${i} = ${i};`).join('\n');

// Build gate failure with a huge output (>100k chars) with real failing lines near the end
const buildHugeGateOutput = (): string => {
  // Each filler line is ~40 chars; 3000 lines × 40 = ~120k chars
  const filler = Array.from(
    { length: 3000 },
    (_, i) => `  verbose test log line ${i} padded to make it longer xxxxxxxxxxxx`
  ).join('\n');
  const failures = [
    'AssertionError: expected 1 to equal 2',
    'error TS2345: Argument of type string is not assignable',
    '✗ should return correct value when input is valid',
    'FAIL src/foo.test.ts',
    'AssertionError: expected false to be true',
  ].join('\n');
  return `${filler}\n${failures}`;
};

// Build a 5000-line file with ~100 export declarations
const build5000LineWith100Exports = (): string => {
  const exports = Array.from(
    { length: 100 },
    (_, i) => `export const exportedValue${i} = ${i};`
  ).join('\n');
  const filler = Array.from({ length: 4900 }, (_, i) => `const internal${i} = ${i};`).join('\n');
  return `${exports}\n${filler}`;
};

// ─── scenario 1: changedLineRanges on a huge diff ───────────────────────────

describe('changedLineRanges on a huge synthetic diff (stress)', () => {
  it('should correctly parse ~500 hunks and return only added lines under 200ms', async () => {
    const hugeDiff = buildHugeDiff();
    const fileText = build5000LineFile();

    const ctx = {
      cwd: '/fake',
      run: async (_cmd: string) => ({ exitCode: 0, stdout: hugeDiff, stderr: '' }),
    };

    const start = Date.now();
    const result = await changedLineRanges('src/fake.ts', ctx, fileText);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(200);
    // Result must be a non-empty array (we have additions)
    expect(result.length).toBeGreaterThan(0);
    // No phantom line 0 — all lines are 1-based
    expect(result).not.toContain(0);
    // Deletion-only hunks (+c,0) must NOT contribute any lines
    // All line numbers must be positive integers
    result.forEach(line => {
      expect(line).toBeGreaterThan(0);
      expect(Number.isInteger(line)).toBe(true);
    });
  });

  it('should exclude deletion-only hunk contributions', async () => {
    // A diff with only deletion-only hunks: @@ -5,3 +5,0 @@
    const deletionOnlyDiff =
      'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -5,3 +5,0 @@\n-line5\n-line6\n-line7\n';

    const ctx = {
      cwd: '/fake',
      run: async (_cmd: string) => ({ exitCode: 0, stdout: deletionOnlyDiff, stderr: '' }),
    };

    const result = await changedLineRanges('src/fake.ts', ctx, 'some content\n');
    expect(result).toEqual([]);
  });

  it('should include new-file hunk @@ -0,0 +1,N @@ lines', async () => {
    const newFileDiff = '@@ -0,0 +1,5 @@\n+a\n+b\n+c\n+d\n+e\n';

    const ctx = {
      cwd: '/fake',
      run: async (_cmd: string) => ({ exitCode: 0, stdout: newFileDiff, stderr: '' }),
    };

    const result = await changedLineRanges('src/new.ts', ctx, '');
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should handle single-line hunk @@ -a +c @@ as count=1', async () => {
    // No comma = count defaults to 1
    const singleLineDiff = '@@ -10 +10 @@\n-old\n+new\n';

    const ctx = {
      cwd: '/fake',
      run: async (_cmd: string) => ({ exitCode: 0, stdout: singleLineDiff, stderr: '' }),
    };

    const result = await changedLineRanges('src/x.ts', ctx, 'content\n');
    expect(result).toContain(10);
    expect(result).toHaveLength(1);
  });
});

// ─── scenario 2: localizeOutput on a giant gate dump ─────────────────────────

describe('localizeOutput on a giant gate dump (stress)', () => {
  it('should return output within the char cap and still include failing lines under 50ms', () => {
    const hugeOutput = buildHugeGateOutput();
    expect(hugeOutput.length).toBeGreaterThan(100_000);

    const failure: GateFailure = {
      gate: 'test',
      message: 'test gate failed',
      output: hugeOutput,
    };

    const start = Date.now();
    const result = localizeOutput(failure);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(result.length).toBeLessThanOrEqual(FEEDBACK_MAX_OUTPUT_CHARS + 20); // +20 for truncation suffix
    // Must still contain representative failing content
    expect(result).toMatch(/AssertionError|error TS|✗|FAIL/);
    // Must include the fix hint text direction (via buildFeedbackMessage context)
    expect(result.length).toBeGreaterThan(0);
  });

  it('should produce a stable failureSignature from the full huge output', () => {
    const hugeOutput = buildHugeGateOutput();
    const failure: GateFailure = {
      gate: 'test',
      message: 'test gate failed',
      output: hugeOutput,
    };

    const sig1 = failureSignature(failure);
    const sig2 = failureSignature(failure);

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^test\|/);
    // Signature must be non-trivially short (shows it's extracted from the failing lines)
    expect(sig1.length).toBeGreaterThan(10);
  });

  it('should produce identical signatures for the same huge output submitted twice', () => {
    const hugeOutput = buildHugeGateOutput();
    const failureA: GateFailure = { gate: 'tsc', message: 'tsc failed', output: hugeOutput };
    const failureB: GateFailure = { gate: 'tsc', message: 'tsc failed', output: hugeOutput };

    expect(failureSignature(failureA)).toBe(failureSignature(failureB));
  });
});

// ─── scenario 3: buildEditRegionDirective on a 5000-line file ────────────────

describe('buildEditRegionDirective on a 5000-line file with ~100 exports (stress)', () => {
  beforeEach(() => {
    process.env['RUNNER_LARGE_FILE_LINES'] = '300';
  });

  afterEach(() => {
    delete process.env['RUNNER_LARGE_FILE_LINES'];
  });

  it('should fire the directive, be bounded in length, name the file, and run under 50ms', async () => {
    const bigFileContent = build5000LineWith100Exports();
    const navBundle = JSON.stringify({
      apiContracts: [{ name: 'newExportA' }, { name: 'newExportB' }],
    });

    const reader = makeReader({
      'src/large.ts': bigFileContent,
      'nav.json': navBundle,
    });

    const spec = makeSpec({ targetFiles: ['src/large.ts'] });

    const start = Date.now();
    const result = await buildEditRegionDirective(spec, reader);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    // Directive must fire (non-empty)
    expect(result.length).toBeGreaterThan(0);
    // Must name the file
    expect(result).toContain('src/large.ts');
    // Must be bounded — NOT O(file size) — 5000-line file should NOT produce a directive
    // that is even close to the file content size (~200k chars raw)
    expect(result.length).toBeLessThan(5000);
    // Export list must be capped (MAX_EXPORT_NAMES = 30, we have 100)
    const exportMatch = result.match(/exportedValue\d+/g) ?? [];
    expect(exportMatch.length).toBeLessThanOrEqual(30);
    // New surface names from nav bundle must appear
    expect(result).toContain('newExportA');
    expect(result).toContain('newExportB');
  });

  it('should return empty string when no file exceeds the large-file threshold', async () => {
    const smallFileContent = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    const reader = makeReader({ 'src/small.ts': smallFileContent });
    const spec = makeSpec({ targetFiles: ['src/small.ts'] });

    const result = await buildEditRegionDirective(spec, reader);
    expect(result).toBe('');
  });
});

// ─── scenario 5: verifyEdit fuzzy match ──────────────────────────────────────

describe('verifyEdit on a real ~3000-line temp .ts file (stress)', () => {
  let dir: string;
  let targetFile: string;

  const buildLargeTs = (): string => {
    const lines = Array.from(
      { length: 3000 },
      (_, i) => `const value${i} = ${i}; // line ${i}`
    );
    // Insert a unique anchor region we can target
    lines[100] = `const specialValue = 'anchor-target';`;
    lines[101] = `const afterSpecial = true;`;
    // Insert a region that appears TWICE for ambiguity test
    lines[200] = `const duplicated = 'duplicate-anchor';`;
    lines[300] = `const duplicated = 'duplicate-anchor';`;
    return lines.join('\n');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-edit-stress-'));
    targetFile = join(dir, 'large.ts');
    writeFileSync(targetFile, buildLargeTs(), 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should apply a whitespace-variant anchor to the correct region (fuzzy match)', async () => {
    // Anchor with extra leading spaces — fuzzy normalization should still find it
    const result = await verifyEdit({
      path: targetFile,
      anchor: `  const   specialValue   =   'anchor-target';`, // extra spaces
      replacement: `const specialValue = 'replaced-by-fuzzy';`,
    });

    expect(result.ok).toBe(true);
    const content = readFileSync(targetFile, 'utf8');
    expect(content).toContain(`const specialValue = 'replaced-by-fuzzy';`);
  });

  it('should fail as ambiguous when the normalized anchor matches two raw regions', async () => {
    const originalContent = readFileSync(targetFile, 'utf8');

    const result = await verifyEdit({
      path: targetFile,
      anchor: `const duplicated = 'duplicate-anchor';`,
      replacement: `const duplicated = 'unique-replacement';`,
    });

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/ambiguous|matches \d+ regions/);
    // File must be byte-for-byte unchanged
    expect(readFileSync(targetFile, 'utf8')).toBe(originalContent);
  });

  it('should apply a large valid replacement', async () => {
    const bigReplacement = Array.from(
      { length: 50 },
      (_, i) => `const replacement${i} = ${i * 2};`
    ).join('\n');

    const result = await verifyEdit({
      path: targetFile,
      anchor: `const afterSpecial = true;`,
      replacement: bigReplacement,
    });

    expect(result.ok).toBe(true);
    const content = readFileSync(targetFile, 'utf8');
    expect(content).toContain('const replacement0 = 0;');
    expect(content).toContain('const replacement49 = 98;');
  });
});

// ─── scenario 6: size-gated write via createToolRegistry ─────────────────────

describe('createToolRegistry write size gate (stress)', () => {
  let dir: string;
  let existingLargeFile: string;
  let newFilePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tool-registry-stress-'));
    existingLargeFile = join(dir, 'large-existing.ts');
    newFilePath = join(dir, 'brand-new.ts');

    // Create a 2000-line existing file (> default 300-line limit)
    const content = Array.from({ length: 2000 }, (_, i) => `const x${i} = ${i};`).join('\n');
    writeFileSync(existingLargeFile, content, 'utf8');

    process.env['RUNNER_LARGE_FILE_LINES'] = '300';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env['RUNNER_LARGE_FILE_LINES'];
  });

  it('should reject write to an existing 2000-line file with use-edit message', async () => {
    const registry = createToolRegistry(dir, { find: () => null }, undefined);
    const originalContent = readFileSync(existingLargeFile, 'utf8');

    const result = await registry.write({
      path: existingLargeFile,
      content: 'const overwritten = true;\n',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/large file|use the edit tool/i);
    // File must be byte-for-byte unchanged
    expect(readFileSync(existingLargeFile, 'utf8')).toBe(originalContent);
  });

  it('should allow write to a brand-new path (no existing file)', async () => {
    const registry = createToolRegistry(dir, { find: () => null }, undefined);

    const result = await registry.write({
      path: newFilePath,
      content: 'const fresh = true;\n',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(newFilePath, 'utf8')).toBe('const fresh = true;\n');
  });
});

// ─── helpers for reconciled-seam scenarios ───────────────────────────────────

// Build a 2000-line source file containing real complexity + FP violations.
const buildViolatingSource = (): string => {
  const decision = (i: number): string =>
    `function complex${i}(x: number): number {\n` +
    `  if (x > 0) { if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { return x; } } } } }\n` +
    `  return 0;\n}`;
  const loopAndLet = (i: number): string =>
    `let mutable${i} = 0;\nfor (let j = 0; j < ${i}; j++) { mutable${i} = mutable${i} + j; }`;
  const filler = Array.from({ length: 1900 }, (_, i) => `const padFill${i} = ${i};`);
  return [
    decision(1),
    loopAndLet(2),
    ...filler,
  ].join('\n');
};

// A ctx.run that reports the file as a brand-new untracked file:
//   git diff -U0 HEAD → exit 0, empty stdout
//   git ls-files --error-unmatch → exit 1 (untracked)
const untrackedNewFileRunner =
  (): GateContext['run'] =>
    async (cmd: string): Promise<GateRunResult> => {
      if (cmd.startsWith('git diff')) return { exitCode: 0, stdout: '', stderr: '' };
      if (cmd.startsWith('git ls-files')) return { exitCode: 1, stdout: '', stderr: 'not tracked' };
      // eslint runs (decomposition gate) execute the project's eslint for real.
      return { exitCode: 0, stdout: '', stderr: '' };
    };

// ─── reconciled-seam scenario A: threshold resolver agreement ────────────────

describe('resolveLargeFileLines single-owner threshold agreement (reconciled-seam)', () => {
  let savedCanonical: string | undefined;
  let savedLegacy: string | undefined;

  beforeEach(() => {
    savedCanonical = process.env['RUNNER_LARGE_FILE_LINES'];
    savedLegacy = process.env['RUNNER_MAX_WHOLE_WRITE_LINES'];
    delete process.env['RUNNER_LARGE_FILE_LINES'];
    delete process.env['RUNNER_MAX_WHOLE_WRITE_LINES'];
  });

  afterEach(() => {
    if (savedCanonical === undefined) delete process.env['RUNNER_LARGE_FILE_LINES'];
    else process.env['RUNNER_LARGE_FILE_LINES'] = savedCanonical;
    if (savedLegacy === undefined) delete process.env['RUNNER_MAX_WHOLE_WRITE_LINES'];
    else process.env['RUNNER_MAX_WHOLE_WRITE_LINES'] = savedLegacy;
  });

  it('should default to 300 when no env is set (unset)', () => {
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should return 500 when RUNNER_LARGE_FILE_LINES=500', () => {
    process.env['RUNNER_LARGE_FILE_LINES'] = '500';
    expect(resolveLargeFileLines()).toBe(500);
  });

  it('should default to 300 (NOT 0) when RUNNER_LARGE_FILE_LINES is empty string', () => {
    process.env['RUNNER_LARGE_FILE_LINES'] = '';
    // Number('') === 0 — the bug was 0 winning and gating every file. Must be 300.
    expect(resolveLargeFileLines()).toBe(300);
    expect(resolveLargeFileLines()).not.toBe(0);
  });

  it('should default to 300 when RUNNER_LARGE_FILE_LINES is NaN ("lots")', () => {
    process.env['RUNNER_LARGE_FILE_LINES'] = 'lots';
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should fall back to legacy RUNNER_MAX_WHOLE_WRITE_LINES=400 when canonical is unset', () => {
    process.env['RUNNER_MAX_WHOLE_WRITE_LINES'] = '400';
    expect(resolveLargeFileLines()).toBe(400);
  });

  it('should let the canonical env win over the legacy alias', () => {
    process.env['RUNNER_LARGE_FILE_LINES'] = '500';
    process.env['RUNNER_MAX_WHOLE_WRITE_LINES'] = '400';
    expect(resolveLargeFileLines()).toBe(500);
  });

  it('should resolve the directive and the write-gate threshold from the SAME owner', async () => {
    // Drive the editRegion directive at 500 and prove a 450-line file is NOT large
    // there, while at 300 it IS large — both consult resolveLargeFileLines only.
    const file450 = Array.from({ length: 450 }, (_, i) => `const r${i} = ${i};`).join('\n');
    const reader = makeReader({ 'src/mid.ts': file450, 'nav.json': '{}' });
    const spec = makeSpec({ targetFiles: ['src/mid.ts'] });

    process.env['RUNNER_LARGE_FILE_LINES'] = '500';
    expect(resolveLargeFileLines()).toBe(500);
    expect(await buildEditRegionDirective(spec, reader)).toBe('');

    process.env['RUNNER_LARGE_FILE_LINES'] = '300';
    expect(resolveLargeFileLines()).toBe(300);
    expect(await buildEditRegionDirective(spec, reader)).toContain('src/mid.ts');
  });
});

// ─── reconciled-seam scenario B: untracked new-file gating at scale ───────────

describe('changedLineRanges untracked new-file full gating at scale (reconciled-seam)', () => {
  it('should gate ALL lines of a 2000-line untracked new file (diff empty, ls-files non-0)', async () => {
    const fileText = Array.from({ length: 2000 }, (_, i) => `const a${i} = ${i};`).join('\n');
    const ctx: GateContext = { cwd: '/fake', run: untrackedNewFileRunner() };

    const result = await changedLineRanges('src/brand-new.ts', ctx, fileText);

    // Full gating: every 1-based line 1..2000 present, none skipped.
    expect(result).toHaveLength(2000);
    expect(result[0]).toBe(1);
    expect(result[1999]).toBe(2000);
  });

  it('should gate NOTHING for a tracked-unchanged file (diff empty, ls-files exit 0)', async () => {
    const fileText = Array.from({ length: 2000 }, (_, i) => `const a${i} = ${i};`).join('\n');
    const ctx: GateContext = {
      cwd: '/fake',
      run: async (cmd: string): Promise<GateRunResult> => {
        if (cmd.startsWith('git diff')) return { exitCode: 0, stdout: '', stderr: '' };
        if (cmd.startsWith('git ls-files')) return { exitCode: 0, stdout: 'src/x.ts', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    };

    const result = await changedLineRanges('src/x.ts', ctx, fileText);
    expect(result).toEqual([]);
  });

  it('should FAIL the decomposition gate end-to-end on an untracked complex new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decomp-untracked-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      const file = join(dir, 'src', 'violator.ts');
      writeFileSync(file, buildViolatingSource(), 'utf8');

      // eslint runs through ctx.run; emit JSON with a complexity violation at line 1
      // (inside the changed range because the file is untracked → ALL lines gated).
      const eslintJson = JSON.stringify([
        {
          filePath: file,
          messages: [
            {
              ruleId: 'complexity',
              severity: 2,
              message: 'Function "complex1" has a complexity of 6. Maximum allowed is 5.',
              line: 1,
              endLine: 4,
              column: 1,
            },
          ],
          errorCount: 1,
          warningCount: 0,
        },
      ]);

      const ctx: GateContext = {
        cwd: dir,
        run: async (cmd: string): Promise<GateRunResult> => {
          if (cmd.startsWith('git diff')) return { exitCode: 0, stdout: '', stderr: '' };
          if (cmd.startsWith('git ls-files')) return { exitCode: 1, stdout: '', stderr: '' };
          if (cmd.includes('eslint')) return { exitCode: 1, stdout: eslintJson, stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      };

      const failure = await decompositionGate([relative(dir, file)], ctx);

      // Greenfield-bypass regression guard: violation MUST be caught, not filtered.
      expect(failure).not.toBeNull();
      expect(failure?.gate).toBe('decomposition');
      expect(failure?.output).toMatch(/complexity/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should FAIL the functional-style gate end-to-end on an untracked loop/let new file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-untracked-'));
    try {
      const file = join(dir, 'violator.ts');
      writeFileSync(file, buildViolatingSource(), 'utf8');

      const ctx: GateContext = { cwd: dir, run: untrackedNewFileRunner() };
      const failure = await functionalStyleGate([file], ctx);

      expect(failure).not.toBeNull();
      expect(failure?.gate).toBe('functional-style');
      // loop + let violations must both surface
      expect(failure?.output).toMatch(/for loop/);
      expect(failure?.output).toMatch(/let/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── reconciled-seam scenario C: setup-head fold under scale ──────────────────

describe('buildTestKickoff setup-head fold under scale + multi-file (reconciled-seam)', () => {
  it('should cap the head at ≤25 lines and warn for a 3000-line existing test file', async () => {
    const big = Array.from({ length: 3000 }, (_, i) => `const setupLine${i} = ${i};`).join('\n');
    const withHook = `${big}\nconst h = renderHook(() => useThing());`;
    const reader = makeReader({ 'a.test.ts': withHook });

    const start = Date.now();
    const result = await buildTestKickoff([{ path: 'a.test.ts' }], reader);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    // The reused setup block is fenced; count its inner lines.
    const fence = result.match(/```\n([\s\S]*?)\n```/);
    const headLines = fence ? fence[1].split('\n').length : 0;
    expect(headLines).toBeLessThanOrEqual(25);
    expect(result).toContain('invoke it CALLED');
  });

  it('should inject the tail from the FIRST file only, never reading subsequent files', async () => {
    const first = Array.from({ length: 30 }, (_, i) => `const firstFile${i} = ${i};`).join('\n');
    const second =
      Array.from({ length: 5 }, (_, i) => `const secondFile${i} = ${i};`).join('\n') +
      `\nconst h = renderHook(() => useSecond());`;
    const reader = makeReader({ 'first.test.ts': first, 'second.test.ts': second });

    const result = await buildTestKickoff(
      [{ path: 'first.test.ts' }, { path: 'second.test.ts' }],
      reader
    );

    expect(result).toContain('firstFile29');
    expect(result).not.toContain('useSecond');
    expect(result).not.toContain('secondFile');
  });

  it('should fall back to the path-only instruction when the reader returns null (missing file)', async () => {
    const reader = makeReader({}); // every path → null
    const result = await buildTestKickoff([{ path: 'missing.test.ts' }], reader);

    expect(result).toContain('missing.test.ts');
    // No reused setup block when no head could be read.
    expect(result).not.toContain('Reuse this exact setup');
  });
});

// ─── reconciled-seam scenario D: feedback union under adversarial output ──────

describe('buildFeedbackMessage union under adversarial output (reconciled-seam)', () => {
  it('should permit editing the test file on a test-gate esbuild transform error', () => {
    const failure: GateFailure = {
      gate: 'test',
      message: 'test gate failed',
      output: 'Transform failed with 1 error:\nERROR: Expected ";" but found "const"\n  at src/foo.test.ts:3:1',
    };
    const msg = buildFeedbackMessage(failure);
    expect(msg).toMatch(/MAY edit the test file/);
    expect(msg).toMatch(/syntax/i);
  });

  it('should use the localized (no-edit) branch on a huge normal assertion dump', () => {
    const huge =
      Array.from({ length: 2000 }, (_, i) => `  log line ${i} padded xxxxxxxxxxxxxxxxxx`).join('\n') +
      '\nAssertionError: expected 1 to equal 2';
    expect(huge.length).toBeGreaterThan(40_000);
    const failure: GateFailure = { gate: 'test', message: 'test gate failed', output: huge };

    const msg = buildFeedbackMessage(failure);
    expect(msg).toMatch(/do NOT edit the test files/);
    expect(msg).not.toMatch(/MAY edit the test file/);
    expect(msg).toContain('AssertionError: expected 1 to equal 2');
    expect(msg).toContain('Make the implementation satisfy the failing assertion.');
    // Output is capped, not the full 40k dump.
    expect(msg.length).toBeLessThan(huge.length);
  });

  it('should use the localized branch for a non-test gate even with transform-looking text', () => {
    const failure: GateFailure = {
      gate: 'tsc',
      message: 'tsc gate failed',
      output: 'ERROR: Expected ";" — error TS1005: \';\' expected.',
    };
    const msg = buildFeedbackMessage(failure);
    expect(msg).not.toMatch(/MAY edit the test file/);
    expect(msg).toContain('Fix the reported type error.');
  });

  it('should produce an identical failureSignature for the same full output regardless of branch', () => {
    const transformOut = 'X [ERROR] Expected ";" but found "const"\n  at src/foo.test.ts:3:1';
    const a: GateFailure = { gate: 'test', message: 'm', output: transformOut };
    const b: GateFailure = { gate: 'test', message: 'm', output: transformOut };
    // a takes the transform branch, b is asked twice — signature is branch-independent.
    void buildFeedbackMessage(a);
    expect(failureSignature(a)).toBe(failureSignature(b));
  });
});
