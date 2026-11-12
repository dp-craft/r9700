import { afinn165 } from 'afinn-165';

import type { Tier2Metrics } from '@/domain/tier2-metrics';

const NON_WORD_PATTERN = /[^\w]+/;
const SENTENCE_PATTERN = /[.!?]+/;
const VOWEL_GROUP_PATTERN = /[aeiouy]+/gi;
const SILENT_E_PATTERN = /e$/i;

const FLESCH_KINCAID_WORD_COEFF = 0.39;
const FLESCH_KINCAID_SYLLABLE_COEFF = 11.8;
const FLESCH_KINCAID_CONSTANT = 15.59;
const MIN_SYLLABLES = 1;
const MIN_SENTENCES = 1;
const READABILITY_APPROXIMATE_THRESHOLD = 0.5;
const READABILITY_MIN_GRADE = 0.5;
const BLEU_MAX_N = 4;
const BLEU_SMOOTHING_EPSILON = 0.1;
const READING_WPM = 238;
const WHITESPACE_PATTERN = /\s+/;
const LOG2: number = Math.log(2);

const tokenize = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(NON_WORD_PATTERN)
    .filter(w => w.length > 0);

const getNgrams = (words: readonly string[], n: number): readonly string[] =>
  words.length < n
    ? []
    : Array.from({ length: words.length - n + 1 }, (_, i) => words.slice(i, i + n).join(' '));

const countSyllables = (word: string): number => {
  const vowelGroups = word.match(VOWEL_GROUP_PATTERN);
  const count = vowelGroups ? vowelGroups.length : 0;
  const adjusted = SILENT_E_PATTERN.test(word) && count > 1 ? count - 1 : count;
  return Math.max(MIN_SYLLABLES, adjusted);
};

const splitSentences = (text: string): readonly string[] =>
  text.split(SENTENCE_PATTERN).filter(s => s.trim().length > 0);

const SENTENCE_WITH_TERMINATOR_PATTERN = /[^.!?]+[.!?]+/g;

const splitSentencesWithTerminators = (text: string): readonly string[] =>
  (text.match(SENTENCE_WITH_TERMINATOR_PATTERN) ?? []).filter(s => s.trim().length > 0);

const countSentences = (text: string): number =>
  Math.max(MIN_SENTENCES, splitSentences(text).length);

export const computeWordCount = (text: string): number =>
  text.split(WHITESPACE_PATTERN).filter(w => w.length > 0).length;

export const computeSentenceCount = (text: string): number => splitSentences(text).length;

export const computeReadingTimeMinutes = (text: string): number =>
  computeWordCount(text) / READING_WPM;

export const computePerplexityEstimate = (text: string): number => {
  const words = text.split(WHITESPACE_PATTERN).filter(w => w.length > 0);
  if (words.length === 0) return 0;

  const freqMap = words.reduce<ReadonlyMap<string, number>>(
    (map, word) => new Map(map).set(word, (map.get(word) ?? 0) + 1),
    new Map<string, number>()
  );

  const total = words.length;
  const entropy = Array.from(freqMap.values()).reduce((sum, freq) => {
    const p = freq / total;
    return sum - p * (Math.log(p) / LOG2);
  }, 0);

  return 2 ** entropy;
};

export const computeLexicalDiversity = (text: string): number => {
  const words = tokenize(text);
  if (words.length === 0) return 0;
  const unique = new Set(words);
  return unique.size / words.length;
};

export const computeRepetitionScore = (text: string): number => {
  const words = tokenize(text);
  const bigrams = getNgrams(words, 2);
  const trigrams = getNgrams(words, 3);
  const allNgrams = [...bigrams, ...trigrams];
  if (allNgrams.length === 0) return 0;

  const freqMap = new Map<string, number>();
  for (const ng of allNgrams) {
    freqMap.set(ng, (freqMap.get(ng) ?? 0) + 1);
  }

  const excessCount = Array.from(freqMap.values()).reduce(
    (sum, freq) => sum + Math.max(0, freq - 1),
    0
  );
  return Math.min(1, Math.max(0, excessCount / allNgrams.length));
};

export const computeReadabilityGrade = (text: string): number => {
  const words = tokenize(text);
  if (words.length === 0) return 0;

  const sentences = countSentences(text);
  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);

  const grade =
    FLESCH_KINCAID_WORD_COEFF * (words.length / sentences) +
    FLESCH_KINCAID_SYLLABLE_COEFF * (totalSyllables / words.length) -
    FLESCH_KINCAID_CONSTANT;

  return Math.max(READABILITY_MIN_GRADE, grade);
};

export const computeRouge1 = (response: string, reference: string): number => {
  const responseWords = new Set(tokenize(response));
  const referenceWords = tokenize(reference);
  if (referenceWords.length === 0) return 0;

  const referenceUnique = new Set(referenceWords);
  const intersection = Array.from(referenceUnique).filter(w => responseWords.has(w));
  return intersection.length / referenceUnique.size;
};

export const computeRouge2 = (response: string, reference: string): number => {
  const responseWords = tokenize(response);
  const referenceWords = tokenize(reference);
  const responseBigrams = new Set(getNgrams(responseWords, 2));
  const referenceBigrams = getNgrams(referenceWords, 2);
  if (referenceBigrams.length === 0) return 0;

  const referenceUniqueSet = new Set(referenceBigrams);
  const intersection = Array.from(referenceUniqueSet).filter(bg => responseBigrams.has(bg));
  return intersection.length / referenceUniqueSet.size;
};

const buildNgramFreqMap = (ngrams: readonly string[]): ReadonlyMap<string, number> => {
  const map = new Map<string, number>();
  for (const ng of ngrams) {
    map.set(ng, (map.get(ng) ?? 0) + 1);
  }
  return map;
};

const computeClippedPrecision = (
  responseNgrams: readonly string[],
  referenceNgrams: readonly string[]
): number => {
  if (responseNgrams.length === 0) return 0;
  const refFreq = buildNgramFreqMap(referenceNgrams);
  const respFreq = buildNgramFreqMap(responseNgrams);

  const clippedSum = Array.from(respFreq.entries()).reduce(
    (sum, [ng, count]) => sum + Math.min(count, refFreq.get(ng) ?? 0),
    0
  );
  return clippedSum / responseNgrams.length;
};

const computeSmoothedPrecision = (
  responseWords: readonly string[],
  referenceWords: readonly string[],
  n: number
): number => {
  const respNg = getNgrams(responseWords, n);
  const refNg = getNgrams(referenceWords, n);
  if (respNg.length === 0 || refNg.length === 0) return 0;
  const raw = computeClippedPrecision(respNg, refNg);
  return n === 1 ? raw : Math.max(raw, BLEU_SMOOTHING_EPSILON / respNg.length);
};

export const computeBleu = (response: string, reference: string): number => {
  const responseWords = tokenize(response);
  const referenceWords = tokenize(reference);
  if (responseWords.length === 0 || referenceWords.length === 0) return 0;

  const maxN = Math.min(BLEU_MAX_N, responseWords.length, referenceWords.length);
  const precisions = Array.from({ length: maxN }, (_, i) =>
    computeSmoothedPrecision(responseWords, referenceWords, i + 1)
  );

  if (precisions.length === 0 || precisions[0] === 0) return 0;

  const validPrecisions = precisions.filter(p => p > 0);
  if (validPrecisions.length === 0) return 0;

  const avgLogPrecision =
    validPrecisions.reduce((sum, p) => sum + Math.log(p), 0) / validPrecisions.length;

  const brevityPenalty =
    responseWords.length < referenceWords.length
      ? Math.exp(1 - referenceWords.length / responseWords.length)
      : 1;

  return brevityPenalty * Math.exp(avgLogPrecision);
};

export const computeKeywordPresence = (response: string, reference: string): number => {
  const responseSet = new Set(tokenize(response));
  const referenceSet = new Set(tokenize(reference));
  if (referenceSet.size === 0) return 0;

  const found = Array.from(referenceSet).filter(w => responseSet.has(w));
  return found.length / referenceSet.size;
};

export const computeJaccardSimilarity = (response: string, reference: string): number => {
  const responseSet = new Set(tokenize(response));
  const referenceSet = new Set(tokenize(reference));
  const union = new Set([...responseSet, ...referenceSet]);
  if (union.size === 0) return 0;

  const intersection = Array.from(responseSet).filter(w => referenceSet.has(w));
  return intersection.length / union.size;
};

const AFINN_LEXICON: Record<string, number> = afinn165;
const QUESTION_SENTENCE_PATTERN = /\?\s*$/;
const PASSIVE_VOICE_PATTERN = /\b(?:was|were|been|is|are|be|being)\s+(?:\w+ed|\w+en)\b/i;
const HEDGING_DENSITY_SCALE = 100;
const HEDGING_TERMS: readonly string[] = [
  'perhaps',
  'maybe',
  'possibly',
  'might',
  'could',
  'likely',
  'seems',
  'suggests',
  'approximately',
  'generally',
  'often',
  'sometimes',
  'probably',
];

const HEDGING_TERM_SET: ReadonlySet<string> = new Set(HEDGING_TERMS);

export const computeSentiment = (text: string): number => {
  const words = tokenize(text);
  if (words.length === 0) return 0;
  const total = words.reduce((sum, word) => sum + (AFINN_LEXICON[word] ?? 0), 0);
  return total / words.length;
};

export const computePassiveVoiceRatio = (text: string): number => {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;
  const passiveCount = sentences.filter(s => PASSIVE_VOICE_PATTERN.test(s)).length;
  return passiveCount / sentences.length;
};

export const computeQuestionDensity = (text: string): number => {
  const sentences = splitSentencesWithTerminators(text);
  if (sentences.length === 0) return 0;
  const questionCount = sentences.filter(s => QUESTION_SENTENCE_PATTERN.test(s)).length;
  return questionCount / sentences.length;
};

export const computeAvgSentenceLength = (text: string): number => {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;
  return computeWordCount(text) / sentences.length;
};

export const computeHedgingDensity = (text: string): number => {
  const words = tokenize(text);
  if (words.length === 0) return 0;
  const hedgingCount = words.filter(w => HEDGING_TERM_SET.has(w)).length;
  return (hedgingCount / words.length) * HEDGING_DENSITY_SCALE;
};

export const computeTier2Metrics = (
  responseText: string,
  referenceAnswer: string | null,
  structureScore: number
): Tier2Metrics => {
  const hasReference = referenceAnswer !== null;
  return {
    lexicalDiversity: computeLexicalDiversity(responseText),
    repetitionScore: computeRepetitionScore(responseText),
    readabilityGrade: computeReadabilityGrade(responseText),
    readabilityApproximate: structureScore > READABILITY_APPROXIMATE_THRESHOLD,
    rouge1: hasReference ? computeRouge1(responseText, referenceAnswer) : null,
    rouge2: hasReference ? computeRouge2(responseText, referenceAnswer) : null,
    bleu: hasReference ? computeBleu(responseText, referenceAnswer) : null,
    keywordPresence: hasReference ? computeKeywordPresence(responseText, referenceAnswer) : null,
    jaccardSimilarity: hasReference
      ? computeJaccardSimilarity(responseText, referenceAnswer)
      : null,
    // Further-measurement fields default to null; the phase-2 analysis pass overrides them.
    perplexity: null,
    sentiment: null,
    passiveVoiceRatio: null,
    questionDensity: null,
    avgSentenceLength: null,
    hedgingDensity: null,
    namedEntityCount: null,
  };
};
