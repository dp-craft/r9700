import { CHARS_PER_TOKEN, TOKEN_HARD_LIMIT, TOKEN_SOFT_LIMIT } from '@/config';
import type { AtomicSkillDTO, SkillCategory, SkillSnapshot } from '@/db/idb';
import { getBuiltinSkillContent } from '@/domain/builtin-skills';
import type { Locale } from '@/i18n/types';

const CANONICAL_LAYER_ORDER: readonly SkillCategory[] = [
  'persona',
  'context',
  'constraints',
  'format',
  'examples',
];

const PROMPT_SEPARATOR = '\n\n---\n\n';
const UNCATEGORIZED_SORT_RANK: number = CANONICAL_LAYER_ORDER.length;

export interface ComposedPrompt {
  readonly text: string;
  readonly tokenCount: number;
  readonly exceedsSoftLimit: boolean;
  readonly exceedsHardLimit: boolean;
}

export interface OrderingIssue {
  readonly skillId: string;
  readonly skillName: string;
  readonly category: SkillCategory;
  readonly expectedPosition: number;
  readonly actualPosition: number;
  readonly message: string;
}

export const EMPTY_COMPOSED_PROMPT: ComposedPrompt = {
  text: '',
  tokenCount: 0,
  exceedsSoftLimit: false,
  exceedsHardLimit: false,
};

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function composePrompt(
  skills: readonly AtomicSkillDTO[],
  languageInstruction?: string
): ComposedPrompt {
  const parts = skills.map(s => s.prompt);
  const hasInstruction = languageInstruction !== undefined && languageInstruction !== '';
  const allParts = hasInstruction ? [...parts, languageInstruction] : parts;
  const text = allParts.join(PROMPT_SEPARATOR);
  const tokenCount = estimateTokens(text);
  return {
    text,
    tokenCount,
    exceedsSoftLimit: tokenCount > TOKEN_SOFT_LIMIT,
    exceedsHardLimit: tokenCount > TOKEN_HARD_LIMIT,
  };
}

export function buildSnapshot(
  containerId: string,
  containerName: string,
  skills: readonly AtomicSkillDTO[],
  languageInstruction?: string
): SkillSnapshot {
  const skillNames = skills.map(s => s.name);
  const hasInstruction = languageInstruction !== undefined && languageInstruction !== '';
  const composedPrompt =
    skills.length === 0 && !hasInstruction ? null : composePrompt(skills, languageInstruction).text;
  return { containerId, containerName, skillNames, composedPrompt };
}

function canonicalRank(category: SkillCategory): number {
  return CANONICAL_LAYER_ORDER.indexOf(category);
}

interface CategorizedEntry {
  readonly actualPosition: number;
  readonly skill: AtomicSkillDTO;
  readonly category: SkillCategory;
  readonly rank: number;
}

function buildCategorizedEntries(skills: readonly AtomicSkillDTO[]): readonly CategorizedEntry[] {
  const acc: CategorizedEntry[] = [];
  for (let index = 0; index < skills.length; index++) {
    const skill = skills[index];
    if (skill.category !== null) {
      acc.push({
        actualPosition: index,
        skill,
        category: skill.category,
        rank: canonicalRank(skill.category),
      });
    }
  }
  return acc;
}

function buildIssueMessage(
  skillName: string,
  category: SkillCategory,
  expected: number,
  actual: number
): string {
  return `"${skillName}" (${category}) is at position ${actual} but should be at position ${expected}`;
}

export function detectOrderingIssues(skills: readonly AtomicSkillDTO[]): readonly OrderingIssue[] {
  const entries = buildCategorizedEntries(skills);
  const sorted = [...entries].sort((a, b) => a.rank - b.rank);
  const issues: OrderingIssue[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expected = sorted[i].actualPosition;
    if (expected !== entry.actualPosition) {
      issues.push({
        skillId: entry.skill.id,
        skillName: entry.skill.name,
        category: entry.category,
        expectedPosition: expected,
        actualPosition: entry.actualPosition,
        message: buildIssueMessage(
          entry.skill.name,
          entry.category,
          expected,
          entry.actualPosition
        ),
      });
    }
  }
  return issues;
}

function sortRank(category: SkillCategory | null): number {
  return category === null ? UNCATEGORIZED_SORT_RANK : canonicalRank(category);
}

export function autoSort(skills: readonly AtomicSkillDTO[]): readonly AtomicSkillDTO[] {
  return [...skills].sort((a, b) => sortRank(a.category) - sortRank(b.category));
}

export function prependCommandPrompt(skillPrompt: string, userMessage: string): string {
  return `[Instructions: ${skillPrompt}]\n\n${userMessage}`;
}

const STANDALONE_SEPARATOR_RE = /^\s*---\s*$/;
const EXCESS_NEWLINES_RE = /\n{3,}/g;
const COLLAPSED_NEWLINES = '\n\n';

const isSeparatorLine = (line: string): boolean => STANDALONE_SEPARATOR_RE.test(line);

export const normalizeSystemPrompt = (text: string): string => {
  const cleaned = text
    .split('\n')
    .filter(line => !isSeparatorLine(line))
    .map(line => line.trim())
    .join('\n');
  const collapsed = cleaned.replace(EXCESS_NEWLINES_RE, COLLAPSED_NEWLINES);
  return collapsed.trim();
};

export const applyFramingPreamble = (composed: string, preamble: string): string =>
  composed === '' ? '' : `${preamble}\n\n${composed}`;

const BUILTIN_PREFIX_TO_KEY: Readonly<Record<string, string>> = {
  '/reason': 'reasoning-coach',
  '/translate': 'translator',
  '/concise': 'concise-writer',
  '/eli5': 'eli5-explainer',
};

function resolveBuiltinKey(skill: AtomicSkillDTO): string | null {
  if (skill.commandPrefix === null) return null;
  return BUILTIN_PREFIX_TO_KEY[skill.commandPrefix] ?? null;
}

export function resolveBuiltinPrompts(
  skills: readonly AtomicSkillDTO[],
  promptLocale: Locale
): readonly AtomicSkillDTO[] {
  const content = getBuiltinSkillContent(promptLocale);
  return skills.map(skill => {
    if (skill.type !== 'builtin') return skill;
    const key = resolveBuiltinKey(skill);
    if (key === null) return skill;
    const override = content[key];
    if (override === undefined) return skill;
    return { ...skill, prompt: override.prompt };
  });
}
