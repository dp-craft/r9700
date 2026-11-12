import {
  computeLexicalDiversity,
  computePerplexityEstimate,
  computeReadabilityGrade,
  computeReadingTimeMinutes,
  computeSentenceCount,
  computeWordCount
} from '@/lib/text-metrics';

import type { RunAnalysisVM } from '../types';

export const buildRunAnalysis = (outputText: string): RunAnalysisVM => ({
  wordCount: computeWordCount(outputText),
  sentenceCount: computeSentenceCount(outputText),
  readingTimeMinutes: computeReadingTimeMinutes(outputText),
  perplexity: computePerplexityEstimate(outputText),
  lexicalDiversity: computeLexicalDiversity(outputText),
  readabilityGrade: computeReadabilityGrade(outputText),
});
