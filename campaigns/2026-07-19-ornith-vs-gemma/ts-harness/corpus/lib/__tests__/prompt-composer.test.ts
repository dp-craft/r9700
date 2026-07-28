import { describe, expect, it } from 'vitest';

import { CHARS_PER_TOKEN, TOKEN_HARD_LIMIT, TOKEN_SOFT_LIMIT } from '@/config';
import type { AtomicSkillDTO } from '@/db/idb';
import { getBuiltinSkillContent } from '@/domain/builtin-skills';
import type { Locale } from '@/i18n/types';
import {
  applyFramingPreamble,
  autoSort,
  buildSnapshot,
  composePrompt,
  detectOrderingIssues,
  estimateTokens,
  normalizeSystemPrompt,
  prependCommandPrompt,
  resolveBuiltinPrompts
} from '@/lib/prompt-composer';

// -- Builders --

const createSkill = (overrides: Partial<AtomicSkillDTO> = {}): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'Test Skill',
  prompt: 'Do something',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const SEPARATOR = '\n\n---\n\n';

// ===========================================================================
// estimateTokens
// ===========================================================================

describe('estimateTokens', () => {
  it('should return 0 when given an empty string', () => {
    const result = estimateTokens('');

    expect(result).toBe(0);
  });

  it('should return 1 when given a single character', () => {
    const result = estimateTokens('a');

    expect(result).toBe(1);
  });

  it('should return Math.ceil(length / CHARS_PER_TOKEN) for any text', () => {
    const text = 'Hello, world!'; // 13 chars => ceil(13/4) = 4

    const result = estimateTokens(text);

    expect(result).toBe(Math.ceil(text.length / CHARS_PER_TOKEN));
  });

  it('should return exact division when text length is a multiple of CHARS_PER_TOKEN', () => {
    const text = 'abcd'; // 4 chars => ceil(4/4) = 1

    const result = estimateTokens(text);

    expect(result).toBe(1);
  });

  it('should ceil up when text length is not a multiple of CHARS_PER_TOKEN', () => {
    const text = 'abcde'; // 5 chars => ceil(5/4) = 2

    const result = estimateTokens(text);

    expect(result).toBe(2);
  });

  it('should handle very long text', () => {
    const text = 'x'.repeat(10000);

    const result = estimateTokens(text);

    expect(result).toBe(2500);
  });
});

// ===========================================================================
// composePrompt
// ===========================================================================

describe('composePrompt', () => {
  it('should return empty text and 0 tokens when given an empty skills array', () => {
    const result = composePrompt([]);

    expect(result.text).toBe('');
    expect(result.tokenCount).toBe(0);
  });

  it('should return the skill prompt as text when given a single skill', () => {
    const skill = createSkill({ prompt: 'You are a helpful assistant.' });

    const result = composePrompt([skill]);

    expect(result.text).toBe('You are a helpful assistant.');
  });

  it('should join multiple skill prompts with the separator', () => {
    const skill1 = createSkill({ id: 's1', prompt: 'First instruction' });
    const skill2 = createSkill({ id: 's2', prompt: 'Second instruction' });

    const result = composePrompt([skill1, skill2]);

    expect(result.text).toBe(`First instruction${SEPARATOR}Second instruction`);
  });

  it('should join three skills with separators between each pair', () => {
    const skills = [
      createSkill({ id: 's1', prompt: 'A' }),
      createSkill({ id: 's2', prompt: 'B' }),
      createSkill({ id: 's3', prompt: 'C' }),
    ];

    const result = composePrompt(skills);

    expect(result.text).toBe(`A${SEPARATOR}B${SEPARATOR}C`);
  });

  it('should calculate token count matching estimateTokens of the composed text', () => {
    const skill1 = createSkill({ id: 's1', prompt: 'Hello' });
    const skill2 = createSkill({ id: 's2', prompt: 'World' });

    const result = composePrompt([skill1, skill2]);

    const expectedTokens = estimateTokens(result.text);
    expect(result.tokenCount).toBe(expectedTokens);
  });

  it('should set exceedsSoftLimit to false when tokens are within soft limit', () => {
    const skill = createSkill({ prompt: 'short' });

    const result = composePrompt([skill]);

    expect(result.exceedsSoftLimit).toBe(false);
  });

  it('should set exceedsSoftLimit to true when tokens exceed soft limit', () => {
    const longPrompt = 'x'.repeat(TOKEN_SOFT_LIMIT * CHARS_PER_TOKEN + 1);
    const skill = createSkill({ prompt: longPrompt });

    const result = composePrompt([skill]);

    expect(result.exceedsSoftLimit).toBe(true);
  });

  it('should set exceedsHardLimit to false when tokens are within hard limit', () => {
    const skill = createSkill({ prompt: 'short' });

    const result = composePrompt([skill]);

    expect(result.exceedsHardLimit).toBe(false);
  });

  it('should set exceedsHardLimit to true when tokens exceed hard limit', () => {
    const longPrompt = 'x'.repeat(TOKEN_HARD_LIMIT * CHARS_PER_TOKEN + 1);
    const skill = createSkill({ prompt: longPrompt });

    const result = composePrompt([skill]);

    expect(result.exceedsHardLimit).toBe(true);
  });

  it('should set both limits to true when tokens exceed hard limit', () => {
    const longPrompt = 'x'.repeat(TOKEN_HARD_LIMIT * CHARS_PER_TOKEN + 1);
    const skill = createSkill({ prompt: longPrompt });

    const result = composePrompt([skill]);

    expect(result.exceedsSoftLimit).toBe(true);
    expect(result.exceedsHardLimit).toBe(true);
  });

  it('should set exceedsSoftLimit to false when tokens equal exactly the soft limit', () => {
    const exactPrompt = 'x'.repeat(TOKEN_SOFT_LIMIT * CHARS_PER_TOKEN);
    const skill = createSkill({ prompt: exactPrompt });

    const result = composePrompt([skill]);

    expect(result.exceedsSoftLimit).toBe(false);
  });

  it('should set exceedsHardLimit to false when tokens equal exactly the hard limit', () => {
    const exactPrompt = 'x'.repeat(TOKEN_HARD_LIMIT * CHARS_PER_TOKEN);
    const skill = createSkill({ prompt: exactPrompt });

    const result = composePrompt([skill]);

    expect(result.exceedsHardLimit).toBe(false);
  });
});

// ===========================================================================
// buildSnapshot
// ===========================================================================

describe('buildSnapshot', () => {
  it('should return a snapshot with containerId, containerName, and composed prompt', () => {
    const skills = [
      createSkill({ id: 's1', name: 'Skill A', prompt: 'Do A' }),
      createSkill({ id: 's2', name: 'Skill B', prompt: 'Do B' }),
    ];

    const result = buildSnapshot('container-1', 'My Container', skills);

    expect(result.containerId).toBe('container-1');
    expect(result.containerName).toBe('My Container');
  });

  it('should include skill names in the snapshot', () => {
    const skills = [
      createSkill({ id: 's1', name: 'Alpha' }),
      createSkill({ id: 's2', name: 'Beta' }),
    ];

    const result = buildSnapshot('c1', 'Container', skills);

    expect(result.skillNames).toEqual(['Alpha', 'Beta']);
  });

  it('should include the composed prompt text in the snapshot', () => {
    const skills = [
      createSkill({ id: 's1', prompt: 'First' }),
      createSkill({ id: 's2', prompt: 'Second' }),
    ];

    const result = buildSnapshot('c1', 'Container', skills);

    expect(result.composedPrompt).toBe(`First${SEPARATOR}Second`);
  });

  it('should return null composedPrompt and empty skillNames when given empty skills', () => {
    const result = buildSnapshot('c1', 'Empty Container', []);

    expect(result.composedPrompt).toBeNull();
    expect(result.skillNames).toEqual([]);
  });

  it('should return the containerId and containerName even when skills are empty', () => {
    const result = buildSnapshot('c1', 'Empty Container', []);

    expect(result.containerId).toBe('c1');
    expect(result.containerName).toBe('Empty Container');
  });

  it('should set composedPrompt to the single skill prompt when given one skill', () => {
    const skill = createSkill({ prompt: 'Only one' });

    const result = buildSnapshot('c1', 'Single', [skill]);

    expect(result.composedPrompt).toBe('Only one');
  });
});

// ===========================================================================
// detectOrderingIssues
// ===========================================================================

describe('detectOrderingIssues', () => {
  it('should return no issues when given an empty array', () => {
    const result = detectOrderingIssues([]);

    expect(result).toEqual([]);
  });

  it('should return no issues when skills are in canonical order', () => {
    const skills = [
      createSkill({ id: 's1', category: 'persona' }),
      createSkill({ id: 's2', category: 'context' }),
      createSkill({ id: 's3', category: 'constraints' }),
      createSkill({ id: 's4', category: 'format' }),
      createSkill({ id: 's5', category: 'examples' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result).toEqual([]);
  });

  it('should return no issues when only some categories are present but in order', () => {
    const skills = [
      createSkill({ id: 's1', category: 'persona' }),
      createSkill({ id: 's2', category: 'format' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result).toEqual([]);
  });

  it('should return no issues when given a single categorized skill', () => {
    const skills = [createSkill({ id: 's1', category: 'constraints' })];

    const result = detectOrderingIssues(skills);

    expect(result).toEqual([]);
  });

  it('should exclude uncategorized skills from ordering checks', () => {
    const skills = [
      createSkill({ id: 's1', category: null }),
      createSkill({ id: 's2', category: 'persona' }),
      createSkill({ id: 's3', category: null }),
      createSkill({ id: 's4', category: 'context' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result).toEqual([]);
  });

  it('should detect issues when format skill appears before persona skill', () => {
    const skills = [
      createSkill({ id: 's1', name: 'Format Skill', category: 'format' }),
      createSkill({ id: 's2', name: 'Persona Skill', category: 'persona' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result.length).toBeGreaterThan(0);
    const issueIds = result.map(issue => issue.skillId);
    expect(issueIds).toContain('s1');
    expect(issueIds).toContain('s2');
  });

  it('should include skillName and category in each ordering issue', () => {
    const skills = [
      createSkill({ id: 's1', name: 'Examples First', category: 'examples' }),
      createSkill({ id: 's2', name: 'Persona Last', category: 'persona' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result.length).toBeGreaterThan(0);
    const exampleIssue = result.find(issue => issue.skillId === 's1');
    expect(exampleIssue).toBeDefined();
    expect(exampleIssue?.skillName).toBe('Examples First');
    expect(exampleIssue?.category).toBe('examples');
  });

  it('should include expectedPosition and actualPosition in each issue', () => {
    const skills = [
      createSkill({ id: 's1', name: 'Examples', category: 'examples' }),
      createSkill({ id: 's2', name: 'Persona', category: 'persona' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result.length).toBeGreaterThan(0);
    result.forEach(issue => {
      expect(typeof issue.expectedPosition).toBe('number');
      expect(typeof issue.actualPosition).toBe('number');
      expect(issue.expectedPosition).not.toBe(issue.actualPosition);
    });
  });

  it('should include a non-empty message in each issue', () => {
    const skills = [
      createSkill({ id: 's1', category: 'examples' }),
      createSkill({ id: 's2', category: 'persona' }),
    ];

    const result = detectOrderingIssues(skills);

    result.forEach(issue => {
      expect(issue.message.length).toBeGreaterThan(0);
    });
  });

  it('should detect issues when context appears after constraints', () => {
    const skills = [
      createSkill({ id: 's1', category: 'constraints' }),
      createSkill({ id: 's2', category: 'context' }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should return no issues when all skills are uncategorized', () => {
    const skills = [
      createSkill({ id: 's1', category: null }),
      createSkill({ id: 's2', category: null }),
    ];

    const result = detectOrderingIssues(skills);

    expect(result).toEqual([]);
  });
});

// ===========================================================================
// autoSort
// ===========================================================================

describe('autoSort', () => {
  it('should return an empty array when given an empty array', () => {
    const result = autoSort([]);

    expect(result).toEqual([]);
  });

  it('should return the same order when skills are already sorted', () => {
    const skills = [
      createSkill({ id: 's1', category: 'persona' }),
      createSkill({ id: 's2', category: 'context' }),
      createSkill({ id: 's3', category: 'constraints' }),
      createSkill({ id: 's4', category: 'format' }),
      createSkill({ id: 's5', category: 'examples' }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('should sort out-of-order skills into canonical order', () => {
    const skills = [
      createSkill({ id: 's1', category: 'examples' }),
      createSkill({ id: 's2', category: 'persona' }),
      createSkill({ id: 's3', category: 'format' }),
      createSkill({ id: 's4', category: 'context' }),
      createSkill({ id: 's5', category: 'constraints' }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['s2', 's4', 's5', 's3', 's1']);
  });

  it('should place uncategorized skills at the end', () => {
    const skills = [
      createSkill({ id: 's1', category: null }),
      createSkill({ id: 's2', category: 'persona' }),
      createSkill({ id: 's3', category: null }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['s2', 's1', 's3']);
  });

  it('should retain relative order for skills within the same category (stable sort)', () => {
    const skills = [
      createSkill({ id: 'p1', name: 'Persona A', category: 'persona' }),
      createSkill({ id: 'p2', name: 'Persona B', category: 'persona' }),
      createSkill({ id: 'c1', name: 'Context A', category: 'context' }),
      createSkill({ id: 'c2', name: 'Context B', category: 'context' }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['p1', 'p2', 'c1', 'c2']);
  });

  it('should retain relative order for uncategorized skills', () => {
    const skills = [
      createSkill({ id: 'u1', category: null }),
      createSkill({ id: 'u2', category: null }),
      createSkill({ id: 'u3', category: null }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['u1', 'u2', 'u3']);
  });

  it('should handle a single skill', () => {
    const skills = [createSkill({ id: 's1', category: 'format' })];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['s1']);
  });

  it('should handle mixed categorized and uncategorized skills', () => {
    const skills = [
      createSkill({ id: 'u1', category: null }),
      createSkill({ id: 'e1', category: 'examples' }),
      createSkill({ id: 'p1', category: 'persona' }),
      createSkill({ id: 'u2', category: null }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['p1', 'e1', 'u1', 'u2']);
  });

  it('should sort correctly when only some canonical categories are present', () => {
    const skills = [
      createSkill({ id: 's1', category: 'format' }),
      createSkill({ id: 's2', category: 'persona' }),
    ];

    const result = autoSort(skills);

    expect(result.map(s => s.id)).toEqual(['s2', 's1']);
  });

  it('should not mutate the input array', () => {
    const skills = [
      createSkill({ id: 's1', category: 'examples' }),
      createSkill({ id: 's2', category: 'persona' }),
    ];
    const originalIds = skills.map(s => s.id);

    autoSort(skills);

    expect(skills.map(s => s.id)).toEqual(originalIds);
  });
});

// ===========================================================================
// prependCommandPrompt
// ===========================================================================

describe('prependCommandPrompt', () => {
  it('should prepend the instruction block to the user message', () => {
    const result = prependCommandPrompt('Be concise', 'What is TypeScript?');

    expect(result).toBe('[Instructions: Be concise]\n\nWhat is TypeScript?');
  });

  it('should format correctly with an empty user message', () => {
    const result = prependCommandPrompt('Be concise', '');

    expect(result).toBe('[Instructions: Be concise]\n\n');
  });

  it('should handle multi-line skill prompts', () => {
    const skillPrompt = 'Line one\nLine two';

    const result = prependCommandPrompt(skillPrompt, 'Hello');

    expect(result).toBe('[Instructions: Line one\nLine two]\n\nHello');
  });

  it('should handle multi-line user messages', () => {
    const userMessage = 'First line\nSecond line\nThird line';

    const result = prependCommandPrompt('Be brief', userMessage);

    expect(result).toBe('[Instructions: Be brief]\n\nFirst line\nSecond line\nThird line');
  });

  it('should handle special characters in the skill prompt', () => {
    const skillPrompt = 'Use {curly braces} and [brackets]';

    const result = prependCommandPrompt(skillPrompt, 'test');

    expect(result).toBe('[Instructions: Use {curly braces} and [brackets]]\n\ntest');
  });

  it('should handle whitespace-only user message', () => {
    const result = prependCommandPrompt('Be concise', '   ');

    expect(result).toBe('[Instructions: Be concise]\n\n   ');
  });
});

// ===========================================================================
// composePrompt — languageInstruction parameter
// ===========================================================================

describe('composePrompt with languageInstruction', () => {
  it('should not change output when languageInstruction is undefined', () => {
    const skill = createSkill({ prompt: 'Be helpful' });

    const withUndefined = composePrompt([skill], undefined);
    const withoutParam = composePrompt([skill]);

    expect(withUndefined.text).toBe(withoutParam.text);
    expect(withUndefined.tokenCount).toBe(withoutParam.tokenCount);
  });

  it('should not change output when languageInstruction is empty string', () => {
    const skill = createSkill({ prompt: 'Be helpful' });

    const withEmpty = composePrompt([skill], '');
    const withoutParam = composePrompt([skill]);

    expect(withEmpty.text).toBe(withoutParam.text);
    expect(withEmpty.tokenCount).toBe(withoutParam.tokenCount);
  });

  it('should append language instruction after skill prompts separated by separator', () => {
    const skill1 = createSkill({ id: 's1', prompt: 'First instruction' });
    const skill2 = createSkill({ id: 's2', prompt: 'Second instruction' });
    const languageInstruction = 'Always respond in French.';

    const result = composePrompt([skill1, skill2], languageInstruction);

    expect(result.text).toBe(
      `First instruction${SEPARATOR}Second instruction${SEPARATOR}Always respond in French.`
    );
  });

  it('should include language instruction in token count', () => {
    const skill = createSkill({ prompt: 'Be helpful' });
    const languageInstruction = 'Always respond in German.';

    const withInstruction = composePrompt([skill], languageInstruction);
    const withoutInstruction = composePrompt([skill]);

    expect(withInstruction.tokenCount).toBeGreaterThan(withoutInstruction.tokenCount);
    expect(withInstruction.tokenCount).toBe(estimateTokens(withInstruction.text));
  });

  it('should return only the instruction text when given zero skills', () => {
    const languageInstruction = 'Always respond in Japanese.';

    const result = composePrompt([], languageInstruction);

    expect(result.text).toBe('Always respond in Japanese.');
    expect(result.tokenCount).toBe(estimateTokens('Always respond in Japanese.'));
  });
});

// ===========================================================================
// buildSnapshot — languageInstruction parameter
// ===========================================================================

describe('buildSnapshot with languageInstruction', () => {
  it('should pass language instruction through to composedPrompt', () => {
    const skills = [
      createSkill({ id: 's1', prompt: 'First' }),
      createSkill({ id: 's2', prompt: 'Second' }),
    ];
    const languageInstruction = 'Respond in Spanish.';

    const result = buildSnapshot('c1', 'Container', skills, languageInstruction);

    expect(result.composedPrompt).toBe(`First${SEPARATOR}Second${SEPARATOR}Respond in Spanish.`);
  });

  it('should not affect composedPrompt when languageInstruction is undefined', () => {
    const skills = [
      createSkill({ id: 's1', prompt: 'First' }),
      createSkill({ id: 's2', prompt: 'Second' }),
    ];

    const withUndefined = buildSnapshot('c1', 'Container', skills, undefined);
    const withoutParam = buildSnapshot('c1', 'Container', skills);

    expect(withUndefined.composedPrompt).toBe(withoutParam.composedPrompt);
    expect(withUndefined.composedPrompt).toBe(`First${SEPARATOR}Second`);
  });
});

// ===========================================================================
// resolveBuiltinPrompts
// ===========================================================================

describe('resolveBuiltinPrompts', () => {
  const createBuiltinSkill = (
    commandPrefix: string,
    overrides: Partial<AtomicSkillDTO> = {}
  ): AtomicSkillDTO =>
    createSkill({
      type: 'builtin',
      commandPrefix,
      prompt: 'original-placeholder-prompt',
      ...overrides,
    });

  it('should return skills unchanged when all are custom type', () => {
    const skills: readonly AtomicSkillDTO[] = [
      createSkill({ id: 's1', prompt: 'Custom prompt A' }),
      createSkill({ id: 's2', prompt: 'Custom prompt B' }),
    ];

    const result = resolveBuiltinPrompts(skills, 'hu');

    expect(result).toEqual(skills);
  });

  it('should replace prompt for builtin skill with prompt-language content', () => {
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/reason', { id: 'b1', name: 'Reasoning Coach' }),
    ];
    const huContent = getBuiltinSkillContent('hu');

    const result = resolveBuiltinPrompts(skills, 'hu');

    expect(result[0].prompt).toBe(huContent['reasoning-coach'].prompt);
  });

  it('should use hu locale content when promptLocale is hu', () => {
    const locale: Locale = 'hu';
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/translate', { id: 'b1' }),
      createBuiltinSkill('/concise', { id: 'b2' }),
      createBuiltinSkill('/eli5', { id: 'b3' }),
      createBuiltinSkill('/reason', { id: 'b4' }),
    ];
    const huContent = getBuiltinSkillContent(locale);

    const result = resolveBuiltinPrompts(skills, locale);

    expect(result[0].prompt).toBe(huContent.translator.prompt);
    expect(result[1].prompt).toBe(huContent['concise-writer'].prompt);
    expect(result[2].prompt).toBe(huContent['eli5-explainer'].prompt);
    expect(result[3].prompt).toBe(huContent['reasoning-coach'].prompt);
  });

  it('should use en locale content when promptLocale is en', () => {
    const locale: Locale = 'en';
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/translate', { id: 'b1' }),
      createBuiltinSkill('/concise', { id: 'b2' }),
      createBuiltinSkill('/eli5', { id: 'b3' }),
      createBuiltinSkill('/reason', { id: 'b4' }),
    ];
    const enContent = getBuiltinSkillContent(locale);

    const result = resolveBuiltinPrompts(skills, locale);

    expect(result[0].prompt).toBe(enContent.translator.prompt);
    expect(result[1].prompt).toBe(enContent['concise-writer'].prompt);
    expect(result[2].prompt).toBe(enContent['eli5-explainer'].prompt);
    expect(result[3].prompt).toBe(enContent['reasoning-coach'].prompt);
  });

  it('should not modify custom skills even when builtins are present', () => {
    const customSkill = createSkill({ id: 'c1', prompt: 'My custom prompt' });
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/reason', { id: 'b1' }),
      customSkill,
    ];

    const result = resolveBuiltinPrompts(skills, 'hu');

    expect(result[1]).toEqual(customSkill);
    expect(result[1].prompt).toBe('My custom prompt');
  });

  it('should handle mixed builtin and custom skills replacing only builtins', () => {
    const huContent = getBuiltinSkillContent('hu');
    const skills: readonly AtomicSkillDTO[] = [
      createSkill({ id: 'c1', prompt: 'Custom A' }),
      createBuiltinSkill('/reason', { id: 'b1' }),
      createSkill({ id: 'c2', prompt: 'Custom B' }),
      createBuiltinSkill('/eli5', { id: 'b2' }),
    ];

    const result = resolveBuiltinPrompts(skills, 'hu');

    expect(result[0].prompt).toBe('Custom A');
    expect(result[1].prompt).toBe(huContent['reasoning-coach'].prompt);
    expect(result[2].prompt).toBe('Custom B');
    expect(result[3].prompt).toBe(huContent['eli5-explainer'].prompt);
  });

  it('should return original skill when builtin has no matching commandPrefix key', () => {
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/unknown-command', { id: 'b1', prompt: 'unmatched prompt' }),
    ];

    const result = resolveBuiltinPrompts(skills, 'hu');

    expect(result[0].prompt).toBe('unmatched prompt');
    expect(result[0]).toEqual(skills[0]);
  });

  it('should return original skill when builtin has null commandPrefix', () => {
    const skill = createSkill({
      id: 'b1',
      type: 'builtin',
      commandPrefix: null,
      prompt: 'null-prefix prompt',
    });
    const skills: readonly AtomicSkillDTO[] = [skill];

    const result = resolveBuiltinPrompts(skills, 'en');

    expect(result[0]).toEqual(skill);
  });

  it('should return empty array when given empty skills array', () => {
    const result = resolveBuiltinPrompts([], 'hu');

    expect(result).toEqual([]);
  });

  it('should not mutate the original skills array', () => {
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/reason', { id: 'b1', prompt: 'original' }),
    ];
    const originalPrompt = skills[0].prompt;

    resolveBuiltinPrompts(skills, 'hu');

    expect(skills[0].prompt).toBe(originalPrompt);
  });

  it('should preserve all skill fields except prompt for resolved builtins', () => {
    const skills: readonly AtomicSkillDTO[] = [
      createBuiltinSkill('/reason', {
        id: 'b1',
        name: 'My Reasoning Skill',
        category: 'persona',
        conditions: 'some-condition',
        createdAt: 12345,
        updatedAt: 67890,
      }),
    ];

    const result = resolveBuiltinPrompts(skills, 'en');

    expect(result[0].id).toBe('b1');
    expect(result[0].name).toBe('My Reasoning Skill');
    expect(result[0].type).toBe('builtin');
    expect(result[0].commandPrefix).toBe('/reason');
    expect(result[0].category).toBe('persona');
    expect(result[0].conditions).toBe('some-condition');
    expect(result[0].createdAt).toBe(12345);
    expect(result[0].updatedAt).toBe(67890);
    expect(result[0].prompt).not.toBe('original-placeholder-prompt');
  });
});

// ===========================================================================
// normalizeSystemPrompt
// ===========================================================================

describe('normalizeSystemPrompt', () => {
  it('should return empty string when given empty string', () => {
    const result = normalizeSystemPrompt('');

    expect(result).toBe('');
  });

  it('should return empty string when given only whitespace', () => {
    const result = normalizeSystemPrompt('   \n  \n   ');

    expect(result).toBe('');
  });

  it('should trim leading and trailing whitespace from the whole text', () => {
    const result = normalizeSystemPrompt('  hello world  ');

    expect(result).toBe('hello world');
  });

  it('should trim trailing whitespace from each line', () => {
    const result = normalizeSystemPrompt('line one   \nline two  ');

    expect(result).toBe('line one\nline two');
  });

  it('should trim leading whitespace from each line', () => {
    const result = normalizeSystemPrompt('  line one\n  line two');

    expect(result).toBe('line one\nline two');
  });

  it('should strip standalone --- separator lines', () => {
    const result = normalizeSystemPrompt('before\n---\nafter');

    expect(result).toBe('before\nafter');
  });

  it('should strip --- separator lines with surrounding whitespace', () => {
    const result = normalizeSystemPrompt('before\n  ---  \nafter');

    expect(result).toBe('before\nafter');
  });

  it('should strip multiple --- separator lines', () => {
    const result = normalizeSystemPrompt('A\n---\nB\n---\nC');

    expect(result).toBe('A\nB\nC');
  });

  it('should not strip --- when part of content text', () => {
    const result = normalizeSystemPrompt('use --- in your response');

    expect(result).toBe('use --- in your response');
  });

  it('should collapse 3+ consecutive newlines to exactly 2', () => {
    const result = normalizeSystemPrompt('above\n\n\nbelow');

    expect(result).toBe('above\n\nbelow');
  });

  it('should collapse 5+ consecutive newlines to exactly 2', () => {
    const result = normalizeSystemPrompt('above\n\n\n\n\nbelow');

    expect(result).toBe('above\n\nbelow');
  });

  it('should preserve exactly 2 consecutive newlines (1 blank line)', () => {
    const result = normalizeSystemPrompt('above\n\nbelow');

    expect(result).toBe('above\n\nbelow');
  });

  it('should preserve single newlines', () => {
    const result = normalizeSystemPrompt('line1\nline2');

    expect(result).toBe('line1\nline2');
  });

  it('should be idempotent — applying twice yields same result', () => {
    const input = '  A  \n---\n\n\n\nB  \n  ---  \n  C  ';
    const once = normalizeSystemPrompt(input);
    const twice = normalizeSystemPrompt(once);

    expect(twice).toBe(once);
  });

  it('should handle combined separator stripping and newline collapsing', () => {
    const result = normalizeSystemPrompt('A\n\n---\n\nB');

    expect(result).toBe('A\n\nB');
  });

  it('should collapse newlines created by separator removal', () => {
    const result = normalizeSystemPrompt('A\n\n\n---\n\n\nB');

    expect(result).toBe('A\n\nB');
  });
});

describe('applyFramingPreamble', () => {
  it('should prepend preamble with double newline when composed is non-empty', () => {
    const result = applyFramingPreamble('Hello world', 'PREAMBLE');

    expect(result).toBe('PREAMBLE\n\nHello world');
  });

  it('should return empty string when composed is empty', () => {
    const result = applyFramingPreamble('', 'PREAMBLE');

    expect(result).toBe('');
  });

  it('should handle multi-line composed text', () => {
    const composed = 'Line 1\nLine 2\nLine 3';
    const result = applyFramingPreamble(composed, 'Follow these instructions:');

    expect(result).toBe('Follow these instructions:\n\nLine 1\nLine 2\nLine 3');
  });

  it('should handle multi-line preamble', () => {
    const preamble = 'Rule 1\nRule 2';
    const result = applyFramingPreamble('Content', preamble);

    expect(result).toBe('Rule 1\nRule 2\n\nContent');
  });
});
