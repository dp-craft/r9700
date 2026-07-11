import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Structural drift guard for the shared rule-fragment library
// (claude-artifacts/agentic-runner-rules) and its paired Claude agents.
// Catches: dangling role @-imports, orphan atoms (no role consumes them),
// and role↔agent name desync. Semantic equivalence stays a human review step.

const FRAGMENT_ROOT = resolve(process.cwd(), 'claude-artifacts/agentic-runner-rules');
const AGENTS_DIR = resolve(process.cwd(), '.claude/agents');

// All six role files are atom consumers — even the two not yet wired into
// rulesProjection.ts (code-refactorer, e2e-test-writer). ui-writer is wired.
const ROLE_NAMES = [
  'code-logic-writer',
  'ts-test-writer',
  'lint-fix-loop',
  'code-refactorer',
  'e2e-test-writer',
  'ui-writer',
] as const;

const IMPORT_RE = /^@([A-Za-z0-9_./-]+\.md)$/;
const AGENT_NAME_RE = /^name:\s*(.+)$/m;

const readText = (path: string): string => readFileSync(path, 'utf8');

const listMarkdown = (dir: string): readonly string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry: string): boolean => entry.endsWith('.md'))
    .map((entry: string): string => join(dir, entry));

const roleFilePath = (name: string): string => join(FRAGMENT_ROOT, 'roles', `${name}.md`);

const importsOf = (roleFile: string): readonly string[] =>
  readText(roleFile)
    .split('\n')
    .map((line: string): string | undefined => line.trim().match(IMPORT_RE)?.[1])
    .filter((match: string | undefined): match is string => typeof match === 'string');

describe('runner rule-fragment integrity', () => {
  const allImports: readonly string[] = ROLE_NAMES.flatMap((name: string): readonly string[] =>
    importsOf(roleFilePath(name))
  );

  it.each(ROLE_NAMES)('should have a role file for %s', (name: string): void => {
    expect(existsSync(roleFilePath(name))).toBe(true);
  });

  it('should resolve every @-import in every role to an existing file', (): void => {
    const dangling: readonly string[] = ROLE_NAMES.flatMap((name: string): readonly string[] =>
      importsOf(roleFilePath(name))
        .filter((rel: string): boolean => !existsSync(resolve(FRAGMENT_ROOT, rel)))
        .map((rel: string): string => `${name}: @${rel}`)
    );

    expect(dangling).toEqual([]);
  });

  it('should have every atom imported by at least one role (no orphan atoms)', (): void => {
    const imported: ReadonlySet<string> = new Set(allImports);
    const orphans: readonly string[] = listMarkdown(join(FRAGMENT_ROOT, 'atoms'))
      .map((path: string): string => relative(FRAGMENT_ROOT, path))
      .filter((rel: string): boolean => !imported.has(rel));

    expect(orphans).toEqual([]);
  });

  it.each(ROLE_NAMES)('should have a Claude agent whose name matches role %s', (name: string): void => {
    const agentNames: readonly (string | undefined)[] = listMarkdown(AGENTS_DIR).map(
      (file: string): string | undefined => readText(file).match(AGENT_NAME_RE)?.[1]?.trim()
    );

    expect(agentNames).toContain(name);
  });
});
