import { describe, expect, it } from 'vitest';

import type { LabRunRow } from '@/db/labRuns';
import type { AtomicSkillDTO } from '@/domain/entities';
import type { PromptEntry } from '@/features/prompt-tester/types';

import { derivePickerHistory, normalizeWhitespace } from '../derivePickerHistory';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const FIXED_TS = 1_700_000_000_000;

const buildPromptEntry = (overrides?: Partial<PromptEntry>): PromptEntry => ({
  id: 'p-1',
  kind: 'custom',
  text: 'Be helpful',
  edited: false,
  ...overrides,
});

const buildLabRunRow = (overrides?: Partial<LabRunRow>): LabRunRow => ({
  id: 'run-1',
  label: 'Run label',
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  configSnapshot: {
    models: [],
    prompts: [buildPromptEntry()],
    userPrompt: 'Hello',
  },
  cells: [],
  selectedCellIds: [],
  compareMode: 'table',
  sort: 'mean',
  group: 'none',
  gridCols: 2,
  ...overrides,
});

const buildSkill = (overrides?: Partial<AtomicSkillDTO>): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'My Skill',
  prompt: 'Do something',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  ...overrides,
});

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------

describe('normalizeWhitespace', () => {
  it('should collapse runs of spaces to a single space', () => {
    expect(normalizeWhitespace('foo   bar')).toBe('foo bar');
  });

  it('should collapse mixed whitespace (tabs and newlines) to a single space', () => {
    expect(normalizeWhitespace('foo\t\tbar\n\nbaz')).toBe('foo bar baz');
  });

  it('should trim leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello world  ')).toBe('hello world');
  });

  it('should return an empty string unchanged when given an empty string', () => {
    expect(normalizeWhitespace('')).toBe('');
  });

  it('should be idempotent — applying twice yields the same result as once', () => {
    const input = '  foo\n  bar\t\tbaz  ';
    expect(normalizeWhitespace(normalizeWhitespace(input))).toBe(normalizeWhitespace(input));
  });
});

// ---------------------------------------------------------------------------
// derivePickerHistory (FR-042 — labRuns source, custom-kind entries only)
// ---------------------------------------------------------------------------

describe('derivePickerHistory', () => {
  it('should return an empty array when no runs are provided', () => {
    expect(derivePickerHistory([], [])).toEqual([]);
  });

  it('should extract a custom-kind prompt entry from a single run', () => {
    const run = buildLabRunRow({
      id: 'run-1',
      updatedAt: FIXED_TS,
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ id: 'p-1', kind: 'custom', text: 'Be helpful' })],
        userPrompt: 'Hello',
      },
    });
    const result = derivePickerHistory([run], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      runId: 'run-1',
      prompt: 'Be helpful',
      recordedAt: FIXED_TS,
    });
  });

  it('should normalize whitespace in custom prompts', () => {
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: '  Be   helpful\n now  ' })],
        userPrompt: '',
      },
    });
    const result = derivePickerHistory([run], []);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Be helpful now');
  });

  it('should ignore prompt entries with kind "skill" or "history" (only kind "custom" counts)', () => {
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [
          buildPromptEntry({ id: 'p-skill', kind: 'skill', text: 'Skill prompt' }),
          buildPromptEntry({ id: 'p-hist', kind: 'history', text: 'History prompt' }),
          buildPromptEntry({ id: 'p-cust', kind: 'custom', text: 'Custom prompt' }),
        ],
        userPrompt: '',
      },
    });
    const result = derivePickerHistory([run], []);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Custom prompt');
  });

  it('should filter out custom prompts whose normalized text matches an atomic skill prompt (FR-042 verified-by #1)', () => {
    const skill = buildSkill({ id: 'sk-1', prompt: 'Be helpful', type: 'custom' });
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: 'Be helpful' })],
        userPrompt: '',
      },
    });
    expect(derivePickerHistory([run], [skill])).toHaveLength(0);
  });

  it('should filter out custom prompts whose normalized text matches a built-in skill prompt (FR-042 verified-by #3)', () => {
    const builtinSkill = buildSkill({
      id: 'sk-builtin',
      prompt: 'Act as an assistant',
      type: 'builtin',
    });
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: 'Act as an assistant' })],
        userPrompt: '',
      },
    });
    expect(derivePickerHistory([run], [builtinSkill])).toHaveLength(0);
  });

  it('should match skill prompts using whitespace-normalized comparison (FR-042)', () => {
    const skill = buildSkill({ prompt: 'Be helpful now' });
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: '  Be  helpful   now  ' })],
        userPrompt: '',
      },
    });
    expect(derivePickerHistory([run], [skill])).toHaveLength(0);
  });

  it('should re-include a previously-matching prompt after the skill is renamed (FR-042 verified-by #2)', () => {
    const renamedSkill = buildSkill({ prompt: 'Completely different prompt now' });
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: 'Be helpful' })],
        userPrompt: '',
      },
    });
    const result = derivePickerHistory([run], [renamedSkill]);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Be helpful');
  });

  it('should deduplicate prompts by normalized text, keeping the most-recent updatedAt', () => {
    const olderRun = buildLabRunRow({
      id: 'run-old',
      updatedAt: FIXED_TS,
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: 'Be helpful' })],
        userPrompt: '',
      },
    });
    const newerRun = buildLabRunRow({
      id: 'run-new',
      updatedAt: FIXED_TS + 1000,
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: '  Be helpful  ' })],
        userPrompt: '',
      },
    });
    const result = derivePickerHistory([olderRun, newerRun], []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ runId: 'run-new', recordedAt: FIXED_TS + 1000 });
  });

  it('should sort results descending by recordedAt (newest first)', () => {
    const runs = [
      buildLabRunRow({
        id: 'run-a',
        updatedAt: FIXED_TS,
        configSnapshot: {
          models: [],
          prompts: [buildPromptEntry({ text: 'Prompt Alpha' })],
          userPrompt: '',
        },
      }),
      buildLabRunRow({
        id: 'run-c',
        updatedAt: FIXED_TS + 2000,
        configSnapshot: {
          models: [],
          prompts: [buildPromptEntry({ text: 'Prompt Gamma' })],
          userPrompt: '',
        },
      }),
      buildLabRunRow({
        id: 'run-b',
        updatedAt: FIXED_TS + 1000,
        configSnapshot: {
          models: [],
          prompts: [buildPromptEntry({ text: 'Prompt Beta' })],
          userPrompt: '',
        },
      }),
    ];
    const result = derivePickerHistory(runs, []);
    expect(result.map(r => r.runId)).toEqual(['run-c', 'run-b', 'run-a']);
  });

  it('should cap the result at 100 items when more than 100 distinct prompts exist', () => {
    const runs: LabRunRow[] = Array.from({ length: 120 }, (_, i) =>
      buildLabRunRow({
        id: `run-${i}`,
        updatedAt: FIXED_TS + i,
        configSnapshot: {
          models: [],
          prompts: [buildPromptEntry({ id: `p-${i}`, text: `Unique prompt number ${i}` })],
          userPrompt: '',
        },
      })
    );
    expect(derivePickerHistory(runs, [])).toHaveLength(100);
  });

  it('should skip prompt entries whose text normalizes to empty', () => {
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [
          buildPromptEntry({ id: 'p-empty', text: '   \n\t  ' }),
          buildPromptEntry({ id: 'p-real', text: 'Real prompt' }),
        ],
        userPrompt: '',
      },
    });
    const result = derivePickerHistory([run], []);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe('Real prompt');
  });

  it('should be deterministic — same inputs produce identical output across multiple calls', () => {
    const run = buildLabRunRow({
      configSnapshot: {
        models: [],
        prompts: [buildPromptEntry({ text: 'Stable prompt' })],
        userPrompt: '',
      },
    });
    const skills: AtomicSkillDTO[] = [];
    const first = derivePickerHistory([run], skills);
    const second = derivePickerHistory([run], skills);
    expect(first).toEqual(second);
  });
});
