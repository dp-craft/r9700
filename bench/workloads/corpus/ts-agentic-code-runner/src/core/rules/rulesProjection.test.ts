import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentType } from '../shared/types';
import { projectRules, type RulesProjection } from './rulesProjection';

const AGENT_TYPES: readonly AgentType[] = ['code-logic-writer', 'ts-test-writer'];

describe('projectRules', () => {
  it('should set agentType on the projection', async () => {
    const result: RulesProjection = await projectRules('ts-test-writer');

    expect(result.agentType).toBe('ts-test-writer');
  });

  it('should produce non-empty condensedRules', async () => {
    const result: RulesProjection = await projectRules('code-logic-writer');

    expect(result.condensedRules.length).toBeGreaterThan(0);
  });

  it.each(
    AGENT_TYPES
  )('should include a tool-catalog section for %s', async (agentType: AgentType) => {
    const result: RulesProjection = await projectRules(agentType);

    expect(result.condensedRules).toContain('## Tool Catalog');
  });

  it.each(
    AGENT_TYPES
  )('should include an output-format-expectations section for %s', async (agentType: AgentType) => {
    const result: RulesProjection = await projectRules(agentType);

    expect(result.condensedRules).toContain('## Output Format Expectations');
  });

  it.each(
    AGENT_TYPES
  )('should include a condensed rules digest section for %s', async (agentType: AgentType) => {
    const result: RulesProjection = await projectRules(agentType);

    expect(result.condensedRules).toContain('## Rules Digest');
  });

  it('should advertise the symbol-based lsp signature, not the path/line/character one', async () => {
    const result: RulesProjection = await projectRules('code-logic-writer');

    expect(result.condensedRules).not.toContain('path, line, character');
    expect(result.condensedRules).toContain('lsp(op, symbol, file?)');
  });

  it('should produce distinct templates per agent type', async () => {
    const logic: RulesProjection = await projectRules('code-logic-writer');
    const test: RulesProjection = await projectRules('ts-test-writer');

    expect(logic.condensedRules).not.toBe(test.condensedRules);
  });
});

describe('projectRules RUNNER_RULES_PATH sourcing', () => {
  const ENV_KEY = 'RUNNER_RULES_PATH';
  let saved: string | undefined;
  let dir: string;

  beforeEach(async () => {
    saved = process.env[ENV_KEY];
    dir = await mkdtemp(join(tmpdir(), 'runner-rules-'));
  });

  afterEach(async () => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('should expand a bare @-import when RUNNER_RULES_PATH is set', async () => {
    const importedRel = relative(process.cwd(), join(dir, 'imported.md'));
    await writeFile(join(dir, 'imported.md'), 'EXPANDED_RULE_CONTENT', 'utf8');
    await writeFile(join(dir, 'root.md'), `@${importedRel}`, 'utf8');
    process.env[ENV_KEY] = join(dir, 'root.md');

    const result: RulesProjection = await projectRules('code-logic-writer');

    expect(result.condensedRules).toContain('EXPANDED_RULE_CONTENT');
    expect(result.condensedRules).not.toContain(`@${importedRel}`);
  });

  it('should fall back to the static digest when RUNNER_RULES_PATH is empty', async () => {
    process.env[ENV_KEY] = '';

    const result: RulesProjection = await projectRules('ts-test-writer');

    expect(result.condensedRules).toContain('## Rules Digest');
    expect(result.condensedRules).toContain('## Tool Catalog');
  });
});
