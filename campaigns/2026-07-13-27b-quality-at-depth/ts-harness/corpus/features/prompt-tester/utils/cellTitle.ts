import { MODEL_AXIS_PREFIX, SYSTEM_AXIS_PREFIX } from './axisLabel';

export const PHRASE_MAX_LENGTH = 48;

const FALLBACK_TITLE = 'Untitled';
const AXIS_LABEL_SEPARATOR = ' · ';
const PHRASE_SEPARATOR = ' – ';

export interface CellTitleInput {
  readonly modelAxisId?: number;
  readonly promptAxisId?: number;
  readonly modelLabel?: string;
  readonly phrase?: string;
}

const truncatePhrase = (phrase: string): string => {
  const trimmed = phrase.trim();
  return trimmed.length > PHRASE_MAX_LENGTH ? `${trimmed.slice(0, PHRASE_MAX_LENGTH)}…` : trimmed;
};

const buildAxisPrefix = (input: CellTitleInput): string => {
  const parts = [
    input.modelAxisId === undefined ? null : `${MODEL_AXIS_PREFIX}${input.modelAxisId}`,
    input.promptAxisId === undefined ? null : `${SYSTEM_AXIS_PREFIX}${input.promptAxisId}`,
  ].filter((part): part is string => part !== null);
  return parts.join(' ');
};

export const formatCellTitle = (input: CellTitleInput): string => {
  const axisPrefix = buildAxisPrefix(input);
  const modelLabel = input.modelLabel?.trim() || '';
  const phrase = input.phrase === undefined ? '' : truncatePhrase(input.phrase);

  const labelWithAxis =
    axisPrefix && modelLabel
      ? `${axisPrefix}${AXIS_LABEL_SEPARATOR}${modelLabel}`
      : axisPrefix || modelLabel;

  const fullPrefix = labelWithAxis || null;
  const fullPhrase = phrase || null;

  if (fullPrefix === null && fullPhrase === null) {
    return FALLBACK_TITLE;
  }
  if (fullPrefix && fullPhrase) {
    return `${fullPrefix}${PHRASE_SEPARATOR}${fullPhrase}`;
  }
  return fullPrefix ?? fullPhrase ?? FALLBACK_TITLE;
};
