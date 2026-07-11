import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ToolExecutionOptions } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRegionStore } from '../execution';
import { resolveLargeFileLines } from '../execution/editRegion';
import {
  buildSdkTools,
  CODE_DRIVE_TOOLS,
  createMutationTracker,
  createToolRegistry,
  TEST_DRIVE_TOOLS
} from './toolRegistry';

const EXEC_OPTS: ToolExecutionOptions = { toolCallId: 'test-call', messages: [] };

describe('createToolRegistry', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tool-registry-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should return file contents when read is invoked', async () => {
    const file = join(cwd, 'hello.txt');
    writeFileSync(file, 'hello world');

    const result = await createToolRegistry(cwd).read({ path: file });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('should create the file when write is invoked', async () => {
    const file = join(cwd, 'out.txt');

    const result = await createToolRegistry(cwd).write({ path: file, content: 'written' });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('written');
  });

  it('should overwrite an existing file when write is invoked', async () => {
    const file = join(cwd, 'over.txt');
    writeFileSync(file, 'old');

    const result = await createToolRegistry(cwd).write({ path: file, content: 'new' });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('new');
  });

  it('should return matching lines when grep is invoked', async () => {
    writeFileSync(join(cwd, 'a.ts'), 'const target = 1;\nconst other = 2;\n');

    const result = await createToolRegistry(cwd).grep({ pattern: 'target' });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('target');
    expect(result.output).not.toContain('other = 2');
  });

  it('should capture stdout when bash is invoked', async () => {
    const result = await createToolRegistry(cwd).bash({ command: 'echo', args: ['runner-ok'] });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('runner-ok');
  });

  it('should report a non-ok result when bash exits non-zero', async () => {
    const result = await createToolRegistry(cwd).bash({ command: 'false' });

    expect(result.ok).toBe(false);
  });

  it('should surface stdout in output when bash writes to stdout and exits non-zero', async () => {
    const result = await createToolRegistry(cwd).bash({
      command: 'sh',
      args: ['-c', 'echo lint-finding-XYZ; exit 1'],
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('lint-finding-XYZ');
  });

  it('should not shell-interpret metacharacters when bash is invoked', async () => {
    const marker = join(cwd, 'pwned');
    // execFile treats the whole string as a single argv token to `echo` —
    // a shell would split on `;` and run `rm`. We assert no shell happened.
    const result = await createToolRegistry(cwd).bash({
      command: 'echo',
      args: [`hello; rm -rf ${marker}`],
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('hello; rm -rf');
  });

  it('should reject a traversal path when read is invoked', async () => {
    const result = await createToolRegistry(cwd).read({ path: '../../../etc/passwd' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('escapes working dir');
  });

  it('should reject a traversal path when write is invoked', async () => {
    const result = await createToolRegistry(cwd).write({
      path: '../escape.txt',
      content: 'nope',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('escapes working dir');
  });

  it('should reject a traversal path when edit is invoked', async () => {
    const result = await createToolRegistry(cwd).edit({
      path: '../escape.ts',
      anchor: 'a',
      replacement: 'b',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('escapes working dir');
  });

  it('should apply the edit via a relative in-cwd path when edit is invoked', async () => {
    writeFileSync(join(cwd, 'rel.ts'), 'const y = 1;\n');

    const result = await createToolRegistry(cwd).edit({
      path: 'rel.ts',
      anchor: 'const y = 1;',
      replacement: 'const y = 42;',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(cwd, 'rel.ts'), 'utf8')).toBe('const y = 42;\n');
  });

  it('should delegate to verifyEdit when verify_edit is invoked', async () => {
    const file = join(cwd, 've.ts');
    writeFileSync(file, 'const z = 1;\n');

    const result = await createToolRegistry(cwd).verify_edit({
      path: file,
      anchor: 'const z = 1;',
      replacement: 'const z = 7;',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('const z = 7;\n');
  });

  it('should consult the nav bundle when lsp is invoked', async () => {
    const navBundle = { find: (): string => 'bundled-hit' };
    const registry = createToolRegistry(cwd, navBundle);

    const result = await registry.lsp({ op: 'definition', symbol: 'Foo' });

    expect(result.ok).toBe(true);
    expect(result.output).toBe('bundled-hit');
  });

  it('should reject an unknown lsp op when lsp is invoked', async () => {
    const result = await createToolRegistry(cwd).lsp({ op: 'bogus', symbol: 'Foo' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('op');
  });

  it('should apply the edit by delegating to verifyEdit when edit is invoked', async () => {
    const file = join(cwd, 'edit.ts');
    writeFileSync(file, 'const x = 1;\n');

    const result = await createToolRegistry(cwd).edit({
      path: file,
      anchor: 'const x = 1;',
      replacement: 'const x = 99;',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('const x = 99;\n');
  });

  it('should write to a path that is in the declared targets', async () => {
    const target = join(cwd, 'allowed.ts');
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({ path: target, content: 'ok' });

    expect(result.ok).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('ok');
  });

  it('should reject a write to an in-cwd path not in the declared targets', async () => {
    const target = join(cwd, 'allowed.ts');
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({ path: join(cwd, 'other.ts'), content: 'nope' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should reject an edit to an in-cwd path not in the declared targets', async () => {
    writeFileSync(join(cwd, 'other.ts'), 'const k = 1;\n');
    const registry = createToolRegistry(cwd, undefined, [join(cwd, 'allowed.ts')]);

    const result = await registry.edit({
      path: join(cwd, 'other.ts'),
      anchor: 'const k = 1;',
      replacement: 'const k = 2;',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should reject a verify_edit to an in-cwd path not in the declared targets', async () => {
    writeFileSync(join(cwd, 'other.ts'), 'const k = 1;\n');
    const registry = createToolRegistry(cwd, undefined, [join(cwd, 'allowed.ts')]);

    const result = await registry.verify_edit({
      path: join(cwd, 'other.ts'),
      anchor: 'const k = 1;',
      replacement: 'const k = 2;',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should allow any in-cwd write when allowedTargets is absent', async () => {
    const file = join(cwd, 'anything.ts');

    const result = await createToolRegistry(cwd).write({ path: file, content: 'ok' });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('ok');
  });

  it('should deny write when allowedTargets is an empty array', async () => {
    const file = join(cwd, 'any.ts');
    const registry = createToolRegistry(cwd, undefined, []);

    const result = await registry.write({ path: file, content: 'bad' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should deny edit when allowedTargets is an empty array', async () => {
    writeFileSync(join(cwd, 'any.ts'), 'const a = 1;\n');
    const registry = createToolRegistry(cwd, undefined, []);

    const result = await registry.edit({
      path: join(cwd, 'any.ts'),
      anchor: 'const a = 1;',
      replacement: 'const a = 2;',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should allow write to a declared target when targets are non-empty', async () => {
    const target = join(cwd, 'src', 'x', 'store.ts');
    mkdirSync(join(cwd, 'src', 'x'), { recursive: true });
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({ path: target, content: 'export const x = 1;' });

    expect(result.ok).toBe(true);
  });

  it('should allow write to co-located __tests__ file when target is declared', async () => {
    const target = join(cwd, 'src', 'x', 'store.ts');
    const testFile = join(cwd, 'src', 'x', '__tests__', 'store.test.ts');
    mkdirSync(join(cwd, 'src', 'x', '__tests__'), { recursive: true });
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({ path: testFile, content: 'it("x", () => {})' });

    expect(result.ok).toBe(true);
  });

  it('should deny write to a sibling non-test file when not in declared targets', async () => {
    const target = join(cwd, 'src', 'x', 'store.ts');
    mkdirSync(join(cwd, 'src', 'x'), { recursive: true });
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({ path: join(cwd, 'src', 'x', 'other.ts'), content: 'x' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should deny write to an unrelated test file not co-located with a declared target', async () => {
    const target = join(cwd, 'src', 'x', 'store.ts');
    mkdirSync(join(cwd, 'src', 'unrelated'), { recursive: true });
    const registry = createToolRegistry(cwd, undefined, [target]);

    const result = await registry.write({
      path: join(cwd, 'src', 'unrelated', 'foo.test.ts'),
      content: 'x',
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should deny write to a test file co-located with declared target when allowlist is empty', async () => {
    const testFile = join(cwd, 'src', 'x', '__tests__', 'store.test.ts');
    mkdirSync(join(cwd, 'src', 'x', '__tests__'), { recursive: true });
    const registry = createToolRegistry(cwd, undefined, []);

    const result = await registry.write({ path: testFile, content: 'x' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  describe('write — size-gated large file rejection', () => {
    it('should reject overwriting an existing file that exceeds the line threshold', async () => {
      const file = join(cwd, 'large.ts');
      const bigContent = Array.from({ length: 301 }, (_, i) => `const line${i} = ${i};`).join('\n');
      writeFileSync(file, bigContent);

      const result = await createToolRegistry(cwd).write({ path: file, content: 'new content' });

      expect(result.ok).toBe(false);
      expect(result.output).toContain('refusing to overwrite a large file');
      expect(result.output).toContain('edit tool');
      // File must NOT be modified
      expect(readFileSync(file, 'utf8')).toBe(bigContent);
    });

    it('should allow overwriting an existing file at or below the threshold', async () => {
      const file = join(cwd, 'small.ts');
      const smallContent = Array.from({ length: 300 }, (_, i) => `const line${i} = ${i};`).join('\n');
      writeFileSync(file, smallContent);

      const result = await createToolRegistry(cwd).write({ path: file, content: 'new content' });

      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('new content');
    });

    it('should allow creating a new file even when content is large', async () => {
      const file = join(cwd, 'new-large.ts');
      const bigContent = Array.from({ length: 500 }, (_, i) => `const line${i} = ${i};`).join('\n');

      const result = await createToolRegistry(cwd).write({ path: file, content: bigContent });

      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(bigContent);
    });

    it('should use RUNNER_MAX_WHOLE_WRITE_LINES env override when set', async () => {
      const file = join(cwd, 'mid.ts');
      // 5 lines in the file
      const content = Array.from({ length: 5 }, (_, i) => `const a${i} = ${i};`).join('\n');
      writeFileSync(file, content);

      // Override threshold to 3 — 5 lines > 3 → should reject
      vi.stubEnv('RUNNER_MAX_WHOLE_WRITE_LINES', '3');
      const result = await createToolRegistry(cwd).write({ path: file, content: 'new' });
      vi.unstubAllEnvs();

      expect(result.ok).toBe(false);
      expect(result.output).toContain('refusing to overwrite a large file');
    });
  });

  it('should not return matches inside node_modules when grep is invoked', async () => {
    writeFileSync(join(cwd, 'src.ts'), 'const needle = 1;\n');
    mkdirSync(join(cwd, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(cwd, 'node_modules', 'pkg', 'dep.ts'), 'const needle = 2;\n');

    const result = await createToolRegistry(cwd).grep({ pattern: 'needle' });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('src.ts');
    expect(result.output).not.toContain('node_modules');
  });
});

describe('buildSdkTools', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tool-sdk-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should expose one SDK tool per registry handler', () => {
    const tools = buildSdkTools(createToolRegistry(cwd));

    expect(Object.keys(tools).sort()).toEqual(
      ['bash', 'edit', 'grep', 'lsp', 'read', 'submit_region', 'verify_edit', 'write'].sort()
    );
  });

  it('should expose only read, edit, and verify_edit for the test drive stage', () => {
    const tools = buildSdkTools(createToolRegistry(cwd), 'test');

    expect(Object.keys(tools).sort()).toEqual(['edit', 'read', 'verify_edit']);
  });

  it('should expose edit, write, verify_edit, submit_region, read, and lsp for the code drive stage', () => {
    const tools = buildSdkTools(createToolRegistry(cwd), 'code');

    expect(Object.keys(tools).sort()).toEqual(
      ['edit', 'lsp', 'read', 'submit_region', 'verify_edit', 'write'].sort()
    );
  });

  it('should omit bash and grep from both drive stages', () => {
    const testTools = Object.keys(buildSdkTools(createToolRegistry(cwd), 'test'));
    const codeTools = Object.keys(buildSdkTools(createToolRegistry(cwd), 'code'));

    expect(testTools).not.toContain('bash');
    expect(testTools).not.toContain('grep');
    expect(codeTools).not.toContain('bash');
    expect(codeTools).not.toContain('grep');
  });

  it('should expose the full tool set when no stage kind is given', () => {
    const tools = buildSdkTools(createToolRegistry(cwd));

    expect(Object.keys(tools).sort()).toEqual(
      ['bash', 'edit', 'grep', 'lsp', 'read', 'submit_region', 'verify_edit', 'write'].sort()
    );
  });

  it('should pin the test-drive allowlist constant', () => {
    expect([...TEST_DRIVE_TOOLS].sort()).toEqual(['edit', 'read', 'verify_edit']);
  });

  it('should pin the code-drive allowlist constant', () => {
    expect([...CODE_DRIVE_TOOLS].sort()).toEqual(
      ['edit', 'lsp', 'read', 'submit_region', 'verify_edit', 'write'].sort()
    );
  });

  it('should give each SDK tool a description, inputSchema, and execute', () => {
    const tools = buildSdkTools(createToolRegistry(cwd));

    expect(typeof tools.read.description).toBe('string');
    expect(tools.read.inputSchema).toBeDefined();
    expect(typeof tools.read.execute).toBe('function');
  });

  it('should run the vendored read handler when the read SDK tool executes', async () => {
    const file = join(cwd, 'd.txt');
    writeFileSync(file, 'dispatched');
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.read.execute?.({ path: file }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(result?.output).toContain('dispatched');
  });

  it('should run the vendored write handler when the write SDK tool executes', async () => {
    const file = join(cwd, 'w.txt');
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.write.execute?.({ path: file, content: 'sdk' }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('sdk');
  });

  it('should run the vendored verify_edit handler when the verify_edit SDK tool executes', async () => {
    const file = join(cwd, 'dv.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.verify_edit.execute?.(
      { path: file, anchor: 'const a = 1;', replacement: 'const a = 2;' },
      EXEC_OPTS
    );

    expect(result?.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('const a = 2;\n');
  });

  it('should run the vendored bash handler when the bash SDK tool executes', async () => {
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.bash.execute?.({ command: 'echo', args: ['sdk-ok'] }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(result?.output).toContain('sdk-ok');
  });

  it('should run the vendored grep handler when the grep SDK tool executes', async () => {
    writeFileSync(join(cwd, 'g.ts'), 'const needle = 1;\n');
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.grep.execute?.({ pattern: 'needle' }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(result?.output).toContain('needle');
  });

  it('should consult the nav bundle when the lsp SDK tool executes', async () => {
    const navBundle = { find: (): string => 'sdk-lsp' };
    const tools = buildSdkTools(createToolRegistry(cwd, navBundle));

    const result = await tools.lsp.execute?.({ op: 'hover', symbol: 'Bar' }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(result?.output).toBe('sdk-lsp');
  });

  it('should run the vendored submit_region handler when the submit_region SDK tool executes', async () => {
    const file = join(cwd, 'sdk-region.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const store = createRegionStore();
    store.record(file, { startLine: 2, endLine: 2 });
    const tools = buildSdkTools(createToolRegistry(cwd, undefined, [file], undefined, store));

    const result = await tools.submit_region.execute?.({ path: file, content: 'B' }, EXEC_OPTS);

    expect(result?.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('a\nB\nc\n');
  });

  it('should reject a traversal path when the read SDK tool executes', async () => {
    const tools = buildSdkTools(createToolRegistry(cwd));

    const result = await tools.read.execute?.({ path: '../../../etc/passwd' }, EXEC_OPTS);

    expect(result?.ok).toBe(false);
    expect(result?.output).toContain('escapes working dir');
  });

  it('should truncate a huge handler output when an SDK tool executes', async () => {
    const huge = 'q'.repeat(200000);
    const registry = createToolRegistry(cwd);
    const tools = buildSdkTools({ ...registry, bash: async () => ({ ok: true, output: huge }) });

    const result = await tools.bash.execute?.({ command: 'echo' }, EXEC_OPTS);

    expect(result?.output.length).toBeLessThan(huge.length);
    expect(result?.output).toContain('truncated');
  });

  it('should reject a write outside the declared targets when the write SDK tool executes', async () => {
    const tools = buildSdkTools(createToolRegistry(cwd, undefined, [join(cwd, 'allowed.ts')]));

    const result = await tools.write.execute?.(
      { path: join(cwd, 'other.ts'), content: 'nope' },
      EXEC_OPTS
    );

    expect(result?.ok).toBe(false);
    expect(result?.output).toContain('not in declared targets');
  });
});

describe('createMutationTracker', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mutation-tracker-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should restore the original content when reverting an existing file', async () => {
    const file = join(cwd, 'existing.ts');
    writeFileSync(file, 'const original = 1;\n');
    const tracker = createMutationTracker(cwd);

    tracker.record(file, 'const original = 1;\n');
    writeFileSync(file, 'const mutated = 2;\n');
    await tracker.revert();

    expect(readFileSync(file, 'utf8')).toBe('const original = 1;\n');
  });

  it('should delete the file when reverting a newly created path', async () => {
    const file = join(cwd, 'created.ts');
    const tracker = createMutationTracker(cwd);

    tracker.record(file, null);
    writeFileSync(file, 'const fresh = 1;\n');
    await tracker.revert();

    expect(existsSync(file)).toBe(false);
  });

  it('should report mutated paths as cwd-relative in first-seen order', async () => {
    const tracker = createMutationTracker(cwd);

    tracker.record(join(cwd, 'b.ts'), null);
    tracker.record(join(cwd, 'a.ts'), null);

    expect(tracker.mutatedPaths()).toEqual(['b.ts', 'a.ts']);
  });

  it('should keep the first snapshot when the same path is recorded twice', async () => {
    const file = join(cwd, 'twice.ts');
    writeFileSync(file, 'first;\n');
    const tracker = createMutationTracker(cwd);

    tracker.record(file, 'first;\n');
    writeFileSync(file, 'second;\n');
    tracker.record(file, 'second;\n');
    await tracker.revert();

    expect(readFileSync(file, 'utf8')).toBe('first;\n');
  });

  it('should record the path when a write goes through a registry built with a tracker', async () => {
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    await registry.write({ path: join(cwd, 'w.ts'), content: 'written' });

    expect(tracker.mutatedPaths()).toEqual(['w.ts']);
  });

  it('should record the path when an edit goes through a registry built with a tracker', async () => {
    const file = join(cwd, 'e.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    await registry.edit({ path: file, anchor: 'const a = 1;', replacement: 'const a = 2;' });

    expect(tracker.mutatedPaths()).toEqual(['e.ts']);
  });

  it('should NOT record a path when a non-mutating read goes through the registry', async () => {
    const file = join(cwd, 'r.ts');
    writeFileSync(file, 'readonly;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    await registry.read({ path: file });

    expect(tracker.mutatedPaths()).toEqual([]);
  });

  it('should NOT record a path when an edit anchor does not match (no write occurred)', async () => {
    const file = join(cwd, 'unmatched.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    const result = await registry.edit({
      path: file,
      anchor: 'const NOPE = 999;',
      replacement: 'const a = 2;',
    });

    expect(result.ok).toBe(false);
    expect(tracker.mutatedPaths()).toEqual([]);
  });

  it('should NOT record a path when a verify_edit anchor does not match', async () => {
    const file = join(cwd, 'unmatched2.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    const result = await registry.verify_edit({
      path: file,
      anchor: 'const NOPE = 999;',
      replacement: 'const a = 2;',
    });

    expect(result.ok).toBe(false);
    expect(tracker.mutatedPaths()).toEqual([]);
  });

  it('should leave an unchanged file untouched on revert after a failed edit anchor', async () => {
    const file = join(cwd, 'noop.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    await registry.edit({ path: file, anchor: 'MISSING', replacement: 'x' });
    await tracker.revert();

    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('const a = 1;\n');
  });

  it('should snapshot PRE-mutation content so a successful edit still reverts', async () => {
    const file = join(cwd, 'pre.ts');
    writeFileSync(file, 'const a = 1;\n');
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, undefined, tracker);

    await registry.edit({ path: file, anchor: 'const a = 1;', replacement: 'const a = 2;' });
    expect(readFileSync(file, 'utf8')).toBe('const a = 2;\n');
    await tracker.revert();

    expect(readFileSync(file, 'utf8')).toBe('const a = 1;\n');
  });
});

describe('submit_region', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'submit-region-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('should splice content over the recorded region when submit_region is invoked', async () => {
    const file = join(cwd, 'target.ts');
    writeFileSync(file, 'a\nb\nc\nd\ne\n');
    const store = createRegionStore();
    store.record(file, { startLine: 2, endLine: 4 });
    const registry = createToolRegistry(cwd, undefined, [file], undefined, store);

    const result = await registry.submit_region({ path: file, content: 'X\nY' });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('a\nX\nY\ne\n');
  });

  it('should reject submit_region and point to the edit tool when no region is recorded', async () => {
    const file = join(cwd, 'noregion.ts');
    writeFileSync(file, 'x\n');
    const store = createRegionStore();
    const registry = createToolRegistry(cwd, undefined, [file], undefined, store);

    const result = await registry.submit_region({ path: file, content: 'y' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('edit tool');
  });

  it('should reject a traversal path when submit_region is invoked', async () => {
    const store = createRegionStore();
    const registry = createToolRegistry(cwd, undefined, undefined, undefined, store);

    const result = await registry.submit_region({ path: '../escape.ts', content: 'x' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('escapes working dir');
  });

  it('should reject submit_region to an in-cwd path not in the declared targets', async () => {
    const file = join(cwd, 'other.ts');
    writeFileSync(file, 'x\n');
    const store = createRegionStore();
    store.record(file, { startLine: 1, endLine: 1 });
    const registry = createToolRegistry(cwd, undefined, [join(cwd, 'allowed.ts')], undefined, store);

    const result = await registry.submit_region({ path: file, content: 'y' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('not in declared targets');
  });

  it('should revert a submit_region splice via the mutation tracker', async () => {
    const file = join(cwd, 'rev.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const store = createRegionStore();
    store.record(file, { startLine: 2, endLine: 2 });
    const tracker = createMutationTracker(cwd);
    const registry = createToolRegistry(cwd, undefined, [file], tracker, store);

    await registry.submit_region({ path: file, content: 'B1\nB2' });
    await tracker.revert();

    expect(readFileSync(file, 'utf8')).toBe('a\nb\nc\n');
  });

  it('should update the recorded region endLine so a second submit stays correct', async () => {
    const file = join(cwd, 'multi.ts');
    writeFileSync(file, 'a\nb\nc\n');
    const store = createRegionStore();
    store.record(file, { startLine: 1, endLine: 1 });
    const registry = createToolRegistry(cwd, undefined, [file], undefined, store);

    await registry.submit_region({ path: file, content: 'X\nY\nZ' });

    expect(store.get(file)).toEqual({ startLine: 1, endLine: 3 });

    await registry.submit_region({ path: file, content: 'Q' });

    expect(readFileSync(file, 'utf8')).toBe('Q\nb\nc\n');
  });
});

describe('resolveLargeFileLines (via tools/index import from editRegion)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return 300 by default when env is not set', () => {
    vi.unstubAllEnvs();
    delete process.env['RUNNER_LARGE_FILE_LINES'];
    delete process.env['RUNNER_MAX_WHOLE_WRITE_LINES'];
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should return the parsed value when RUNNER_LARGE_FILE_LINES is a valid number', () => {
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '50');
    expect(resolveLargeFileLines()).toBe(50);
  });

  it('should return 300 when RUNNER_LARGE_FILE_LINES is NaN', () => {
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', 'not-a-number');
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should return 300 when RUNNER_LARGE_FILE_LINES is empty string', () => {
    vi.stubEnv('RUNNER_LARGE_FILE_LINES', '');
    delete process.env['RUNNER_MAX_WHOLE_WRITE_LINES'];
    expect(resolveLargeFileLines()).toBe(300);
  });

  it('should honour RUNNER_MAX_WHOLE_WRITE_LINES as fallback when RUNNER_LARGE_FILE_LINES is unset', () => {
    delete process.env['RUNNER_LARGE_FILE_LINES'];
    vi.stubEnv('RUNNER_MAX_WHOLE_WRITE_LINES', '150');
    expect(resolveLargeFileLines()).toBe(150);
  });
});
