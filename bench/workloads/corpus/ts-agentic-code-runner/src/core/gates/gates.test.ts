import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  changedLineRanges,
  complexityFailure,
  complexitySourceFiles,
  decompositionGate,
  fpViolations,
  functionalStyleGate,
  type Gate,
  type GateContext,
  type GateFailure,
  type GateRunResult,
  lintGate,
  runGates,
  scopedLintGate,
  scopedTestGate,
  testGate,
  tscGate,
  VITEST_BIN
} from './gates';

const okResult = { exitCode: 0, stdout: '', stderr: '' };
const failResult = { exitCode: 1, stdout: 'boom', stderr: 'broken' };

const ctxWith = (run: GateContext['run']): GateContext => ({ cwd: '/repo', run });

describe('lintGate', () => {
  it('should return null when the runner exits zero', async () => {
    const result = await lintGate(ctxWith(() => Promise.resolve(okResult)));

    expect(result).toBeNull();
  });

  it('should return a lint GateFailure when the runner exits non-zero', async () => {
    const result = await lintGate(ctxWith(() => Promise.resolve(failResult)));

    expect(result?.gate).toBe('lint');
  });
});

describe('scopedLintGate', () => {
  it('should return null without invoking ctx.run when files list is empty', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const ctx: GateContext = { cwd: '/repo', run };

    const result = await scopedLintGate([])(ctx);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('should build an eslint command containing the resolved file path', async () => {
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedLintGate(['src/x.ts'])(ctx);

    expect(captured).toContain('eslint');
    expect(captured).toContain(resolve('/repo', 'src/x.ts'));
  });

  it('should pass --fix (autofix touched files) and NOT use biome', async () => {
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedLintGate(['src/x.ts'])(ctx);

    expect(captured).toContain('--fix');
    expect(captured).not.toContain('biome');
  });

  it('should NOT lint the whole src tree (no glob)', async () => {
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedLintGate(['src/x.ts'])(ctx);

    expect(captured).not.toContain('src/**');
  });

  it('should return a lint GateFailure when ctx.run exits non-zero', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 1, stdout: 'lint boom', stderr: 'broken' });
    const ctx: GateContext = { cwd: '/repo', run };

    const result = await scopedLintGate(['src/x.ts'])(ctx);

    expect(result?.gate).toBe('lint');
    expect(result?.output).toContain('lint boom');
  });
});

describe('tscGate', () => {
  it('should return null when the runner exits zero', async () => {
    const result = await tscGate(ctxWith(() => Promise.resolve(okResult)));

    expect(result).toBeNull();
  });

  it('should return a tsc GateFailure carrying the runner output when it exits non-zero', async () => {
    const result = await tscGate(ctxWith(() => Promise.resolve(failResult)));

    expect(result?.gate).toBe('tsc');
    expect(result?.output).toContain('broken');
  });
});

describe('testGate', () => {
  it('should return null when the runner exits zero', async () => {
    const result = await testGate(ctxWith(() => Promise.resolve(okResult)));

    expect(result).toBeNull();
  });

  it('should return a test GateFailure when the runner exits non-zero', async () => {
    const result = await testGate(ctxWith(() => Promise.resolve(failResult)));

    expect(result?.gate).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// complexitySourceFiles
// ---------------------------------------------------------------------------

describe('complexitySourceFiles', () => {
  it('should keep plain TypeScript source files', () => {
    const result = complexitySourceFiles(['src/lib/x.ts', 'src/components/Foo.tsx']);

    expect(result).toStrictEqual(['src/lib/x.ts', 'src/components/Foo.tsx']);
  });

  it('should drop .test.ts files', () => {
    const result = complexitySourceFiles(['foo.test.ts']);

    expect(result).toHaveLength(0);
  });

  it('should drop .spec.tsx files', () => {
    const result = complexitySourceFiles(['foo.spec.tsx']);

    expect(result).toHaveLength(0);
  });

  it('should drop files inside __tests__ directories', () => {
    const result = complexitySourceFiles(['src/__tests__/bar.ts']);

    expect(result).toHaveLength(0);
  });

  it('should keep source files and drop test files from a mixed list', () => {
    const result = complexitySourceFiles([
      'src/lib/x.ts',
      'foo.test.ts',
      'foo.spec.tsx',
      'src/__tests__/bar.ts',
    ]);

    expect(result).toStrictEqual(['src/lib/x.ts']);
  });

  it('should return an empty array when given an empty list', () => {
    const result = complexitySourceFiles([]);

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// complexityFailure
// ---------------------------------------------------------------------------

describe('complexityFailure', () => {
  it('should return null when exitCode is 0 (clean run)', () => {
    const result: GateRunResult = { exitCode: 0, stdout: '', stderr: '' };

    expect(complexityFailure(result)).toBeNull();
  });

  it('should return a decomposition GateFailure when exit non-zero (tool-agnostic)', () => {
    const result: GateRunResult = {
      exitCode: 1,
      stdout: 'complexity rule violation',
      stderr: '',
    };

    const failure = complexityFailure(result);

    expect(failure).not.toBeNull();
    expect(failure?.gate).toBe('decomposition');
  });

  it('should include the combined output in the returned failure', () => {
    const result: GateRunResult = {
      exitCode: 1,
      stdout: 'complexity violation found',
      stderr: 'additional context',
    };

    const failure = complexityFailure(result);

    expect(failure?.output).toContain('complexity violation found');
    expect(failure?.output).toContain('additional context');
  });

  it('should return null when exit is zero regardless of output content', () => {
    const result: GateRunResult = {
      exitCode: 0,
      stdout: 'complexity anything',
      stderr: '',
    };

    expect(complexityFailure(result)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// decompositionGate
// ---------------------------------------------------------------------------

describe('decompositionGate', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'gates-decomp-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return null and not call ctx.run when only test files are supplied', async () => {
    const run = vi.fn<GateContext['run']>();
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['foo.test.ts'], ctx);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('should return null and not call ctx.run when only spec files are supplied', async () => {
    const run = vi.fn<GateContext['run']>();
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['bar.spec.tsx', 'src/__tests__/baz.ts'], ctx);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('should return null and not call ctx.run when given an empty file list', async () => {
    const run = vi.fn<GateContext['run']>();
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate([], ctx);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('should call ctx.run with a command containing eslint and --config when source files are present', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const ctx: GateContext = { cwd: tmpDir, run };

    await decompositionGate(['src/lib/foo.ts'], ctx);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toContain('eslint');
    expect(run.mock.calls[0][0]).toContain('--config');
  });

  it('should NOT use biome in the gate command', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const ctx: GateContext = { cwd: tmpDir, run };

    await decompositionGate(['src/lib/foo.ts'], ctx);

    expect(run.mock.calls[0][0]).not.toContain('biome');
  });

  it('should return null when ctx.run exits zero (no complexity violation)', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/lib/foo.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should return a decomposition GateFailure when ctx.run exits non-zero', async () => {
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 1,
      stdout: 'complexity rule error',
      stderr: '',
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/lib/foo.ts'], ctx);

    expect(result?.gate).toBe('decomposition');
  });

  it('should return null (fail-open) when ctx.run exits non-zero with empty output', async () => {
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: '',
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/lib/foo.ts'], ctx);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fpViolations
// ---------------------------------------------------------------------------

describe('fpViolations', () => {
  it('should return a for-loop violation entry when source contains a for statement', () => {
    const source = 'const x = [1,2,3];\nfor (const i of x) { console.log(i); }';

    const result = fpViolations(source, 'test.ts');

    expect(result.length).toBeGreaterThan(0);
    expect(result.some(v => v.kind === 'for loop')).toBe(true);
  });

  it('should return a while-loop violation entry when source contains a while statement', () => {
    const source = 'let n = 0;\nwhile (n < 3) { n++; }';

    const result = fpViolations(source, 'test.ts');

    expect(result.some(v => v.kind === 'while loop')).toBe(true);
  });

  it('should return a do-while violation entry when source contains a do-while statement', () => {
    const source = 'let n = 0;\ndo { n++; } while (n < 3);';

    const result = fpViolations(source, 'test.ts');

    expect(result.some(v => v.kind === 'do-while loop')).toBe(true);
  });

  it('should return a let violation entry when source contains a let declaration', () => {
    const source = 'let x = 5;';

    const result = fpViolations(source, 'test.ts');

    expect(result.some(v => v.kind === 'let')).toBe(true);
  });

  it('should return a var violation entry when source contains a var declaration', () => {
    const source = 'var x = 5;';

    const result = fpViolations(source, 'test.ts');

    expect(result.some(v => v.kind === 'var')).toBe(true);
  });

  it('should return a class violation entry when source contains a class declaration', () => {
    const source = 'class MyClass { method() { return 1; } }';

    const result = fpViolations(source, 'test.ts');

    expect(result.some(v => v.kind === 'class')).toBe(true);
  });

  it('should return an empty array for clean functional source using const, map, filter, arrow fns', () => {
    const source = [
      'const double = (x: number): number => x * 2;',
      'const nums = [1, 2, 3];',
      'const doubled = nums.map(double);',
      'const evens = nums.filter((n): boolean => n % 2 === 0);',
      'const found = nums.find((n): boolean => n > 1);',
      'export { doubled, evens, found };',
    ].join('\n');

    const result = fpViolations(source, 'test.ts');

    expect(result).toHaveLength(0);
  });

  it('should include the correct line number for the violation', () => {
    const source = 'const a = 1;\nfor (let i = 0; i < 3; i++) {}';

    const result = fpViolations(source, 'test.ts');

    const forViolation = result.find(v => v.kind === 'for loop');
    expect(forViolation?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// functionalStyleGate
// ---------------------------------------------------------------------------

describe('functionalStyleGate', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fp-gate-test-'));

    await writeFile(
      join(tmpDir, 'clean.ts'),
      'const double = (x: number): number => x * 2;\nexport { double };\n',
      'utf8'
    );
    await writeFile(
      join(tmpDir, 'dirty.ts'),
      'const xs = [1,2,3];\nfor (const x of xs) { console.log(x); }\n',
      'utf8'
    );
    await writeFile(
      join(tmpDir, 'dirty.test.ts'),
      'for (const x of [1,2,3]) { console.log(x); }\n',
      'utf8'
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return a functional-style GateFailure when a source file contains a for loop', async () => {
    const ctx: GateContext = { cwd: tmpDir, run: vi.fn() as GateContext['run'] };

    const result = await functionalStyleGate(['dirty.ts'], ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('functional-style');
  });

  it('should return null when all source files are clean', async () => {
    const ctx: GateContext = { cwd: tmpDir, run: vi.fn() as GateContext['run'] };

    const result = await functionalStyleGate(['clean.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should return null when RUNNER_FP_GATE is set to 0 even for dirty files', async () => {
    const original = process.env.RUNNER_FP_GATE;
    process.env.RUNNER_FP_GATE = '0';
    try {
      const ctx: GateContext = { cwd: tmpDir, run: vi.fn() as GateContext['run'] };

      const result = await functionalStyleGate(['dirty.ts'], ctx);

      expect(result).toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.RUNNER_FP_GATE;
      } else {
        process.env.RUNNER_FP_GATE = original;
      }
    }
  });

  it('should return null when only test files are passed', async () => {
    const ctx: GateContext = { cwd: tmpDir, run: vi.fn() as GateContext['run'] };

    const result = await functionalStyleGate(['dirty.test.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should include file and line details in the output field of the failure', async () => {
    const ctx: GateContext = { cwd: tmpDir, run: vi.fn() as GateContext['run'] };

    const result = await functionalStyleGate(['dirty.ts'], ctx);

    expect(result?.output).toContain('dirty.ts');
    expect(result?.output).toContain('for loop');
  });
});

// ---------------------------------------------------------------------------
// scopedTestGate
// ---------------------------------------------------------------------------

describe('scopedTestGate', () => {
  const ORIGINAL_SCOPE = process.env.RUNNER_TEST_SCOPE;

  afterEach(() => {
    if (ORIGINAL_SCOPE === undefined) {
      delete process.env.RUNNER_TEST_SCOPE;
    } else {
      process.env.RUNNER_TEST_SCOPE = ORIGINAL_SCOPE;
    }
  });

  it('should return null when ctx.run exits zero (scoped path)', async () => {
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const ctx: GateContext = { cwd: '/repo', run };

    const result = await scopedTestGate(['src/x.ts'])(ctx);

    expect(result).toBeNull();
  });

  it('should build a command containing vitest related --run and the resolved file path by default', async () => {
    delete process.env.RUNNER_TEST_SCOPE;
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedTestGate(['src/x.ts'])(ctx);

    expect(captured).toContain('vitest');
    expect(captured).toContain('related');
    expect(captured).toContain('--run');
    expect(captured).toContain(resolve('/repo', 'src/x.ts'));
  });

  it('should run npm test when RUNNER_TEST_SCOPE=full', async () => {
    process.env.RUNNER_TEST_SCOPE = 'full';
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedTestGate(['src/x.ts'])(ctx);

    expect(captured).toBe('npm test');
  });

  it('should run npm test when files list is empty', async () => {
    delete process.env.RUNNER_TEST_SCOPE;
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await scopedTestGate([])(ctx);

    expect(captured).toBe('npm test');
  });

  it('should return a test GateFailure when ctx.run exits non-zero', async () => {
    delete process.env.RUNNER_TEST_SCOPE;
    const run = vi
      .fn<GateContext['run']>()
      .mockResolvedValue({ exitCode: 1, stdout: 'FAIL', stderr: 'broken' });
    const ctx: GateContext = { cwd: '/repo', run };

    const result = await scopedTestGate(['src/x.ts'])(ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('test');
  });

  it('should export VITEST_BIN as the local vitest binary path', () => {
    expect(VITEST_BIN).toBe('./node_modules/.bin/vitest');
  });
});

// ---------------------------------------------------------------------------
// changedLineRanges
// ---------------------------------------------------------------------------

describe('changedLineRanges', () => {
  it('should return all line numbers when git diff exits 128 (untracked / no HEAD)', async () => {
    // Arrange: simulate "no HEAD" by exit code 128
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 128,
      stdout: '',
      stderr: 'unknown revision',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    // file with 5 lines
    const fileText = 'a\nb\nc\nd\ne\n';

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    // All 5 lines should be in range
    expect(result).toContain(1);
    expect(result).toContain(5);
  });

  it('should return all line numbers when the file has no HEAD version (exit 1, empty diff)', async () => {
    // git diff on a new file untracked returns exit 1 with empty stdout in some setups
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = 'line1\nline2\nline3\n';

    const result = await changedLineRanges('src/new.ts', ctx, fileText);

    expect(result).toContain(1);
    expect(result).toContain(3);
  });

  it('should return only the changed line numbers from a hunk header @@ -1,3 +1,3 @@', async () => {
    const diffOutput = [
      'diff --git a/src/x.ts b/src/x.ts',
      'index abc..def 100644',
      '--- a/src/x.ts',
      '+++ b/src/x.ts',
      '@@ -10,3 +10,3 @@',
      '-old line',
      '+new line',
    ].join('\n');
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = Array.from({ length: 15 }, (_, i) => `line${i + 1}`).join('\n');

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    // @@ -10,3 +10,3 @@ → lines 10,11,12 changed
    expect(result).toContain(10);
    expect(result).toContain(11);
    expect(result).toContain(12);
    expect(result).not.toContain(9);
    expect(result).not.toContain(13);
  });

  it('should return only line c when hunk header is @@ -a +c @@ (single line, no comma)', async () => {
    const diffOutput = '@@ -5 +7 @@\n-old\n+new\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).toContain(7);
    expect(result).not.toContain(8);
  });

  it('should return empty array for a tracked-unchanged file (diff exit 0 empty + ls-files exit 0)', async () => {
    const run = vi.fn<GateContext['run']>().mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd.includes('ls-files')
          ? { exitCode: 0, stdout: 'src/x.ts\n', stderr: '' } // tracked
          : { exitCode: 0, stdout: '', stderr: '' } // diff: no changes
      )
    );
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = 'no changes here\n';

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).toHaveLength(0);
  });

  it('should return ALL lines for a new/untracked file (diff exit 0 empty + ls-files non-zero)', async () => {
    const run = vi.fn<GateContext['run']>().mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd.includes('ls-files')
          ? { exitCode: 1, stdout: '', stderr: 'error: pathspec did not match' } // untracked-new
          : { exitCode: 0, stdout: '', stderr: '' } // diff: empty (untracked → no HEAD diff)
      )
    );
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = 'line1\nline2\nline3';

    const result = await changedLineRanges('src/new.ts', ctx, fileText);

    // Whole new file must be gated — every line returned.
    expect(result).toEqual([1, 2, 3]);
  });

  it('should fall back to all lines when git diff output is unparseable (broken diff)', async () => {
    // Returns exit 0 but garbage stdout with no hunk headers
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 2,
      stdout: 'garbage not a diff',
      stderr: 'internal error',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = 'line1\nline2\n';

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).toContain(1);
    expect(result).toContain(2);
  });

  it('should return empty array for a deletion-only hunk @@ -5,3 +5,0 @@', async () => {
    const diffOutput = '@@ -5,3 +5,0 @@\n-removed\n-line\n-here\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).toHaveLength(0);
  });

  it('should return empty array for a new-file deletion hunk @@ -10,2 +0,0 @@', async () => {
    const diffOutput = '@@ -10,2 +0,0 @@\n-a\n-b\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = Array.from({ length: 5 }, (_, i) => `line${i + 1}`).join('\n');

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).toHaveLength(0);
  });

  it('should yield only addition lines when a deletion hunk and an addition hunk are mixed', async () => {
    // First hunk: deletion-only (+5,0) → should contribute nothing
    // Second hunk: addition (+20,2) → should contribute lines 20 and 21
    const diffOutput = '@@ -5,3 +5,0 @@\n-gone\n@@ -30,0 +20,2 @@\n+added1\n+added2\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: '/repo', run };
    const fileText = Array.from({ length: 25 }, (_, i) => `line${i + 1}`).join('\n');

    const result = await changedLineRanges('src/x.ts', ctx, fileText);

    expect(result).not.toContain(5);
    expect(result).toContain(20);
    expect(result).toContain(21);
    expect(result).not.toContain(22);
  });

  it('should call git diff with -U0 HEAD -- and the resolved file path', async () => {
    let captured = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      captured = cmd;
      return { exitCode: 0, stdout: '@@ -1 +1 @@\n+line', stderr: '' };
    });
    const ctx: GateContext = { cwd: '/repo', run };

    await changedLineRanges('src/x.ts', ctx, 'line\n');

    expect(captured).toContain('git diff');
    expect(captured).toContain('-U0');
    expect(captured).toContain('HEAD');
    expect(captured).toContain('src/x.ts');
  });
});

// ---------------------------------------------------------------------------
// functionalStyleGate — changed-range scoping
// ---------------------------------------------------------------------------

describe('functionalStyleGate (changed-range scoping)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fp-gate-scope-test-'));
    // File has a for loop on line 2 (pre-existing) and a const on line 1 (clean)
    await writeFile(
      join(tmpDir, 'preexisting.ts'),
      'const a = 1;\nfor (const x of []) { console.log(x); }\n',
      'utf8'
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return null when the only violation is on an unchanged line', async () => {
    // Arrange: only line 1 changed (diff says +1,1), violation is on line 2
    const diffOutput = '@@ -1 +1 @@\n-old\n+const a = 1;\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await functionalStyleGate(['preexisting.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should return a failure when the violation is on a changed line', async () => {
    // Arrange: both lines changed
    const diffOutput = '@@ -1,2 +1,2 @@\n-a\n-b\n+const a = 1;\n+for (const x of []) {}\n';
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 0,
      stdout: diffOutput,
      stderr: '',
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await functionalStyleGate(['preexisting.ts'], ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('functional-style');
  });

  it('should gate whole file when git diff fails (fall back)', async () => {
    // Arrange: git unavailable
    const run = vi.fn<GateContext['run']>().mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr: 'git: command not found',
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await functionalStyleGate(['preexisting.ts'], ctx);

    // Whole file gated → for loop on line 2 triggers failure
    expect(result).not.toBeNull();
    expect(result?.gate).toBe('functional-style');
  });
});

// ---------------------------------------------------------------------------
// decompositionGate — changed-range scoping
// ---------------------------------------------------------------------------

describe('decompositionGate (changed-range scoping)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'decomp-scope-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should return null when complexity violation is only on an unchanged line', async () => {
    // Arrange: ESLint JSON reports a violation on line 10; diff only covers line 1
    const eslintJson = JSON.stringify([
      {
        filePath: '/repo/src/foo.ts',
        messages: [{ ruleId: 'complexity', severity: 2, message: 'too complex', line: 10, column: 1 }],
        errorCount: 1,
        warningCount: 0,
      },
    ]);
    const calls: string[] = [];
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      calls.push(cmd);
      // First call = git diff, second = eslint
      if (cmd.includes('git diff')) {
        return { exitCode: 0, stdout: '@@ -1 +1 @@\n+changed\n', stderr: '' };
      }
      return { exitCode: 1, stdout: eslintJson, stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/foo.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should return a failure when complexity violation is on a changed line', async () => {
    const eslintJson = JSON.stringify([
      {
        filePath: '/repo/src/foo.ts',
        messages: [{ ruleId: 'complexity', severity: 2, message: 'too complex', line: 5, column: 1 }],
        errorCount: 1,
        warningCount: 0,
      },
    ]);
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) {
        return { exitCode: 0, stdout: '@@ -3,5 +3,5 @@\n+changed\n', stderr: '' };
      }
      return { exitCode: 1, stdout: eslintJson, stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/foo.ts'], ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('decomposition');
  });

  it('should fall back to raw output when ESLint does not return parseable JSON', async () => {
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) {
        return { exitCode: 0, stdout: '@@ -1 +1 @@\n', stderr: '' };
      }
      // Non-JSON eslint output (e.g. binary missing, old version)
      return { exitCode: 1, stdout: 'some raw eslint error text', stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/foo.ts'], ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('decomposition');
    expect(result?.output).toContain('raw eslint error');
  });

  it('should keep a complexity finding whose function range [line..endLine] overlaps a changed line', async () => {
    // Declaration on line 10, function body ends on line 40; only line 25 changed
    const eslintJson = JSON.stringify([
      {
        filePath: `${tmpDir}/src/foo.ts`,
        messages: [
          {
            ruleId: 'complexity',
            severity: 2,
            message: 'too complex',
            line: 10,
            endLine: 40,
            column: 1,
          },
        ],
        errorCount: 1,
        warningCount: 0,
      },
    ]);
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) {
        // Only line 25 changed
        return { exitCode: 0, stdout: '@@ -25 +25 @@\n+changed\n', stderr: '' };
      }
      return { exitCode: 1, stdout: eslintJson, stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/foo.ts'], ctx);

    expect(result).not.toBeNull();
    expect(result?.gate).toBe('decomposition');
  });

  it('should drop a complexity finding whose function range [line..endLine] does not overlap any changed line', async () => {
    // Declaration on line 10, function body ends on line 40; only line 5 changed (outside)
    const eslintJson = JSON.stringify([
      {
        filePath: `${tmpDir}/src/foo.ts`,
        messages: [
          {
            ruleId: 'complexity',
            severity: 2,
            message: 'too complex',
            line: 10,
            endLine: 40,
            column: 1,
          },
        ],
        errorCount: 1,
        warningCount: 0,
      },
    ]);
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) {
        // Only line 5 changed — outside function range [10..40]
        return { exitCode: 0, stdout: '@@ -5 +5 @@\n+changed\n', stderr: '' };
      }
      return { exitCode: 1, stdout: eslintJson, stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    const result = await decompositionGate(['src/foo.ts'], ctx);

    expect(result).toBeNull();
  });

  it('should pass --format json (or -f json) to the eslint command', async () => {
    let eslintCmd = '';
    const run = vi.fn<GateContext['run']>().mockImplementation(async (cmd: string) => {
      if (cmd.includes('git diff')) {
        return { exitCode: 0, stdout: '@@ -1 +1 @@\n', stderr: '' };
      }
      eslintCmd = cmd;
      return { exitCode: 0, stdout: '[]', stderr: '' };
    });
    const ctx: GateContext = { cwd: tmpDir, run };

    await decompositionGate(['src/foo.ts'], ctx);

    expect(eslintCmd).toMatch(/--format json|-f json/);
  });
});

describe('runGates', () => {
  it('should return null when every gate passes', async () => {
    const ctx = ctxWith(() => Promise.resolve(okResult));

    const result = await runGates([lintGate, tscGate, testGate], ctx);

    expect(result).toBeNull();
  });

  it('should return the first GateFailure encountered', async () => {
    const passing: Gate = () => Promise.resolve(null);
    const failing: Gate = () => Promise.resolve({ gate: 'tsc', message: 'x', output: 'y' });

    const result = await runGates(
      [passing, failing],
      ctxWith(() => Promise.resolve(okResult))
    );

    expect(result).toEqual({ gate: 'tsc', message: 'x', output: 'y' });
  });

  it('should not invoke a later gate after an earlier gate fails', async () => {
    const earlyFailure: GateFailure = { gate: 'lint', message: 'fail', output: '' };
    const failing: Gate = () => Promise.resolve(earlyFailure);
    const laterGate = vi.fn<Gate>(() => Promise.resolve(null));

    const result = await runGates(
      [failing, laterGate],
      ctxWith(() => Promise.resolve(okResult))
    );

    expect(result).toBe(earlyFailure);
    expect(laterGate).not.toHaveBeenCalled();
  });

  it('should run gates in order and pass the context to each', async () => {
    const ctx = ctxWith(() => Promise.resolve(okResult));
    const gateA = vi.fn<Gate>(() => Promise.resolve(null));
    const gateB = vi.fn<Gate>(() => Promise.resolve(null));

    await runGates([gateA, gateB], ctx);

    expect(gateA).toHaveBeenCalledWith(ctx);
    expect(gateB).toHaveBeenCalledWith(ctx);
  });
});
