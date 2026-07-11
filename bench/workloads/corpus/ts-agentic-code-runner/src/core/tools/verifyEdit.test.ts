import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildAnchorRecoveryHint, verifyEdit } from './verifyEdit';

describe('verifyEdit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-edit-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should apply the edit and report ok when anchor matches exactly once', async () => {
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'const x = 1;\nconst y = 2;\n');

    const result = await verifyEdit({
      path: file,
      anchor: 'const x = 1;',
      replacement: 'const x = 42;',
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('const x = 42;\nconst y = 2;\n');
  });

  it('should reject and leave the file unchanged when the anchor is absent', async () => {
    const file = join(dir, 'b.ts');
    const original = 'const x = 1;\n';
    writeFileSync(file, original);

    const result = await verifyEdit({
      path: file,
      anchor: 'const z = 9;',
      replacement: 'const z = 0;',
    });

    expect(result.ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('should reject and leave the file unchanged when the anchor is ambiguous', async () => {
    const file = join(dir, 'c.ts');
    const original = 'foo();\nfoo();\n';
    writeFileSync(file, original);

    const result = await verifyEdit({ path: file, anchor: 'foo();', replacement: 'bar();' });

    expect(result.ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('should reject when the path does not point to a readable file', async () => {
    const missing = join(dir, 'nope.ts');

    const result = await verifyEdit({ path: missing, anchor: 'anything', replacement: 'x' });

    expect(result.ok).toBe(false);
  });

  it('should reject when the path is a directory', async () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);

    const result = await verifyEdit({ path: sub, anchor: 'anything', replacement: 'x' });

    expect(result.ok).toBe(false);
  });

  describe('idempotency guard — replacement contains anchor', () => {
    it('should succeed on first application when replacement contains the anchor', async () => {
      const file = join(dir, 'idem-first.ts');
      writeFileSync(file, 'const updateCell = (\n  body();\n};\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const updateCell = (',
        replacement: 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};',
      });

      expect(result.ok).toBe(true);
    });

    it('should reject a re-application with output containing "already applied"', async () => {
      const file = join(dir, 'idem-second.ts');
      writeFileSync(file, 'const updateCell = (\n  body();\n};\n');

      await verifyEdit({
        path: file,
        anchor: 'const updateCell = (',
        replacement: 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};',
      });

      const secondResult = await verifyEdit({
        path: file,
        anchor: 'const updateCell = (',
        replacement: 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};',
      });

      expect(secondResult.ok).toBe(false);
      expect(secondResult.output.toLowerCase()).toContain('already applied');
    });

    it('should leave the file unchanged after a rejected re-application', async () => {
      const file = join(dir, 'idem-unchanged.ts');
      writeFileSync(file, 'const updateCell = (\n  body();\n};\n');

      await verifyEdit({
        path: file,
        anchor: 'const updateCell = (',
        replacement: 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};',
      });

      const afterFirst = readFileSync(file, 'utf8');

      await verifyEdit({
        path: file,
        anchor: 'const updateCell = (',
        replacement: 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};',
      });

      expect(readFileSync(file, 'utf8')).toBe(afterFirst);
    });

    it('should apply exactly once and produce exactly one replacement body across 20 calls', async () => {
      const file = join(dir, 'idem-stress.ts');
      writeFileSync(file, 'const updateCell = (\n  body();\n};\n');

      const anchor = 'const updateCell = (';
      const replacement = 'const updateCell = (\n  set: SetFn,\n): void => {\n  body();\n};';

      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        const result = await verifyEdit({ path: file, anchor, replacement });
        results.push(result.ok);
      }

      const successCount = results.filter(ok => ok).length;
      expect(successCount).toBe(1);

      const failureCount = results.filter(ok => !ok).length;
      expect(failureCount).toBe(19);

      const finalContent = readFileSync(file, 'utf8');
      const bodyOccurrences = finalContent.split('): void => {').length - 1;
      expect(bodyOccurrences).toBe(1);
    });

    it('should not falsely reject when replacement does not contain the anchor', async () => {
      const file = join(dir, 'idem-normal.ts');
      writeFileSync(file, 'const x = 1;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;',
        replacement: 'const x = 42;',
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('const x = 42;\n');
    });

    it('should not falsely reject when replacement is a short string already elsewhere in file but not at anchor position', async () => {
      const file = join(dir, 'idem-elsewhere.ts');
      writeFileSync(file, 'const foo = 1;\n// 42 is used here\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const foo = 1;',
        replacement: '42',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('fuzzy anchor match — whitespace-normalized fallback', () => {
    it('should apply edit when anchor differs only in leading indentation', async () => {
      const file = join(dir, 'fuzzy-indent.ts');
      writeFileSync(file, 'function foo() {\n  const x = 1;\n  return x;\n}\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;\n  return x;',
        replacement: 'const x = 42;\n  return x;',
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('const x = 42;');
    });

    it('should apply edit when anchor uses extra spaces vs file single spaces', async () => {
      const file = join(dir, 'fuzzy-spaces.ts');
      writeFileSync(file, 'const  x = 1;\n');

      // Anchor with single space (file has double space) — normalized match
      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;',
        replacement: 'const x = 99;',
      });

      // Exact match fails (single vs double space), fuzzy should find it
      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('99');
    });

    it('should reject with "anchor not found" message when normalized match also misses', async () => {
      const file = join(dir, 'fuzzy-miss.ts');
      writeFileSync(file, 'const x = 1;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const totally_absent = 999;',
        replacement: 'const z = 0;',
      });

      expect(result.ok).toBe(false);
      expect(result.output).toContain('anchor not found');
    });

    it('should reject with "matches N regions" message when normalized match is ambiguous', async () => {
      const file = join(dir, 'fuzzy-ambig.ts');
      // Two occurrences that are identical when whitespace-normalized
      writeFileSync(file, 'const  x = 1;\nconst  x = 1;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;',
        replacement: 'const x = 99;',
      });

      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/matches \d+ regions/);
    });

    it('should reject when two DIFFERENT raw regions both normalize to the same anchor text', async () => {
      const file = join(dir, 'fuzzy-different-raw-same-norm.ts');
      // "const x  = 1;" and "const  x = 1;" look different but both normalize to "const x = 1;"
      writeFileSync(file, 'const x  = 1;\nconst  x = 1;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;',
        replacement: 'const x = 99;',
      });

      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/matches \d+ regions/);
      // File must NOT be modified
      expect(readFileSync(file, 'utf8')).toBe('const x  = 1;\nconst  x = 1;\n');
    });

    it('should report the line number in the success output when a fuzzy match is applied', async () => {
      const file = join(dir, 'fuzzy-line-report.ts');
      // File uses double-space indent; anchor uses single-space — forces fuzzy path
      writeFileSync(file, 'function foo() {\n    const x = 1;\n    return x;\n}\n');

      const result = await verifyEdit({
        path: file,
        anchor: '  const x = 1;\n  return x;',
        replacement: '  const x = 42;\n  return x;',
      });

      expect(result.ok).toBe(true);
      expect(result.output).toMatch(/line \d+/);
    });

    it('should apply correctly when exactly one raw region matches the normalized anchor', async () => {
      const file = join(dir, 'fuzzy-unique-norm.ts');
      // "const  y = 2;" normalizes to "const y = 2;"; the anchor "const y = 2;" is unique
      writeFileSync(file, 'const x = 1;\nconst  y = 2;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const y = 2;',
        replacement: 'const y = 99;',
      });

      expect(result.ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('const x = 1;\nconst y = 99;\n');
    });
  });

  describe('recovery hint on anchor miss', () => {
    it('should list the nearest existing lines with path:lineNo when the anchor is not found', async () => {
      const file = join(dir, 'hint-nearest.ts');
      writeFileSync(
        file,
        'const handleSubmit = (event) => {\nconst handleCancel = (event) => {\nconst unrelated = 7;\n'
      );

      const result = await verifyEdit({
        path: file,
        anchor: 'const handleSubmitForm = (event) => {',
        replacement: 'const handleSubmitForm = (event) => { stop();',
      });

      expect(result.ok).toBe(false);
      expect(result.output).toContain('copy one VERBATIM');
      expect(result.output).toContain(`${file}:1: const handleSubmit = (event) => {`);
      expect(result.output).toContain(`${file}:2: const handleCancel = (event) => {`);
      // File must remain untouched
      expect(readFileSync(file, 'utf8')).toContain('const handleSubmit = (event) => {');
    });

    it('should keep the success-path ToolResult byte-identical', async () => {
      const file = join(dir, 'hint-success.ts');
      writeFileSync(file, 'const x = 1;\n');

      const result = await verifyEdit({
        path: file,
        anchor: 'const x = 1;',
        replacement: 'const x = 42;',
      });

      expect(result).toEqual({ ok: true, output: `verify_edit: applied edit to ${file}` });
    });

    it('should fall back to the generic message when the file read throws', async () => {
      const failingRead = (): Promise<string> => Promise.reject(new Error('EACCES'));

      const hint = await buildAnchorRecoveryHint(
        '/some/path.ts',
        'const x = 1;',
        'edit: anchor not found (exact and whitespace-normalized)',
        failingRead
      );

      expect(hint).toBe('edit: anchor not found (exact and whitespace-normalized)');
    });

    it('should fall back to the generic message when no line shares a token with the anchor', async () => {
      const reader = (): Promise<string> => Promise.resolve('aaa\nbbb\nccc\n');

      const hint = await buildAnchorRecoveryHint(
        '/some/path.ts',
        'zzz qqq',
        'edit: anchor not found (exact and whitespace-normalized)',
        reader
      );

      expect(hint).toBe('edit: anchor not found (exact and whitespace-normalized)');
    });
  });
});
