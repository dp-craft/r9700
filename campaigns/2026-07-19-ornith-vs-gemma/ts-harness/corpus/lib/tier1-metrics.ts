import { CHARS_PER_TOKEN } from '@/config';
import type { Tier1MetricsDTO } from '@/db/idb';

export interface StreamTimings {
  readonly requestStartedAt: number;
  readonly firstTokenAt: number;
  readonly completedAt: number;
}

const HEADING_PATTERN = /^#{1,6}\s/;
const UNORDERED_LIST_PATTERN = /^[-*]\s/;
const ORDERED_LIST_PATTERN = /^\d+\.\s/;
const CODE_FENCE = '```';
const STRUCTURE_WEIGHT = 0.25;

const countMatches = (lines: readonly string[], pattern: RegExp): number =>
  lines.filter(line => pattern.test(line.trimStart())).length;

const countCodeFences = (text: string): number => {
  const fenceCount = text.split(CODE_FENCE).length - 1;
  return Math.floor(fenceCount / 2);
};

const countParagraphs = (text: string): number => {
  const blocks = text.split(/\n\s*\n/).filter(block => block.trim().length > 0);
  return blocks.length > 1 ? blocks.length : 0;
};

export const computeStructureScore = (text: string): number => {
  if (text.trim().length === 0) return 0;

  const lines = text.split('\n');
  const headings = countMatches(lines, HEADING_PATTERN);
  const unorderedLists = countMatches(lines, UNORDERED_LIST_PATTERN);
  const orderedLists = countMatches(lines, ORDERED_LIST_PATTERN);
  const codeBlocks = countCodeFences(text);
  const paragraphs = countParagraphs(text);

  const elementCount = headings + unorderedLists + orderedLists + codeBlocks + paragraphs;

  if (elementCount === 0) return 0;

  return 1 - 1 / (1 + elementCount * STRUCTURE_WEIGHT);
};

const countWords = (text: string): number =>
  text.split(/\s+/).filter(word => word.length > 0).length;

const computeEstimatedTokens = (charCount: number): number =>
  charCount === 0 ? 0 : Math.ceil(charCount / CHARS_PER_TOKEN);

export const computeTier1Metrics = (
  responseText: string,
  timings: StreamTimings
): Tier1MetricsDTO => ({
  responseTimeMs: timings.completedAt - timings.requestStartedAt,
  timeToFirstTokenMs: timings.firstTokenAt - timings.requestStartedAt,
  charCount: responseText.length,
  wordCount: countWords(responseText),
  estimatedTokens: computeEstimatedTokens(responseText.length),
  codeBlockCount: countCodeFences(responseText),
  structureScore: computeStructureScore(responseText),
});
