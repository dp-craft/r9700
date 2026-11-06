import type { TranslationFunction } from '@/i18n';

import type { DetailPanelLabels } from '../components/DetailPanel';
import type { ModelParamsReadOnlyBlockProps } from '../components/ModelParamsReadOnlyBlock';
import type { ModelEntry, ResolvedModelSnapshot } from '../types';

export const resolvedSnapshotToModelEntry = (resolved: ResolvedModelSnapshot): ModelEntry => ({
  id: '',
  providerId: resolved.providerId,
  modelKey: resolved.modelKey,
  name: resolved.name,
  params: resolved.params,
  thinking: resolved.thinking,
  supportsThinking: false,
  expanded: false,
  accent: false,
});

export const buildDetailLabels = (t: TranslationFunction): Partial<DetailPanelLabels> => ({
  responseSection: t('promptTester.responseSection'),
  performanceMetrics: t('promptTester.performanceMetricsSection'),
  textAnalysis: t('promptTester.textAnalysisSection'),
  llmJudge: t('promptTester.llmJudgeSection'),
  judgeWithLlm: t('promptTester.judgeWithLlm'),
  overallScore: t('promptTester.overallScore'),
  timeToFirstToken: t('promptTester.timeToFirstToken'),
  estimatedTokens: t('promptTester.estimatedTokens'),
  repetitionScore: t('promptTester.repetitionScore'),
  readabilityGrade: t('promptTester.readabilityGrade'),
  approximateSuffix: t('promptTester.approximateSuffix'),
  statusWaiting: t('promptTester.statusWaiting'),
  statusStreamingResponse: t('promptTester.statusStreamingResponse'),
  perplexity: t('promptTester.perplexity'),
  sentiment: t('promptTester.sentiment'),
  passiveVoiceRatio: t('promptTester.passiveVoiceRatio'),
  questionDensity: t('promptTester.questionDensity'),
  avgSentenceLength: t('promptTester.avgSentenceLength'),
  hedgingDensity: t('promptTester.hedgingDensity'),
  namedEntityCount: t('promptTester.namedEntityCount'),
});

export const buildParamLabels = (
  t: TranslationFunction
): ModelParamsReadOnlyBlockProps['labels'] => ({
  temp: t('lab.model.label.temp'),
  topP: t('lab.model.label.top-p'),
  maxTok: t('lab.model.label.max-tok'),
  freq: t('lab.model.label.freq'),
  pres: t('lab.model.label.pres'),
  contextSize: t('lab.model.label.context-size'),
  thinking: t('lab.model.toggle.thinking'),
  thinkingBudget: t('lab.model.label.thinking-budget'),
});

export const buildModelParamsVM = (
  model: ModelEntry,
  labels: ModelParamsReadOnlyBlockProps['labels']
): ModelParamsReadOnlyBlockProps => ({
  params: model.params,
  supportsThinking: model.supportsThinking,
  thinking: model.thinking,
  thinkingBudget: undefined,
  labels,
});
