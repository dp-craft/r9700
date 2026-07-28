import { useShallow } from 'zustand/react/shallow';

import { type TranslationFunction, useTranslation } from '@/i18n';

import type { CompareQualityLabels, CompareStripProps } from '../components/CompareStrip';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import type { CompareMode, ModelParamsReadOnlyLabels, RunTab } from '../types';
import { buildCompareRows, type CompareMetricLabels } from '../utils/buildCompareRows';

const MIN_COMPARE_CELLS = 2;

const METRIC_KEYS: readonly string[] = [
  'latency',
  'tps',
  'perplexity',
  'perplexity-true',
  'readability',
  'lexicalDiversity',
  'wordCount',
  'sentenceCount',
  'readingTime',
  'sentiment',
  'passiveVoiceRatio',
  'questionDensity',
  'ngramRepetition',
  'namedEntityCount',
  'avgSentenceLength',
  'hedgingDensity',
];

const buildParamLabels = (t: TranslationFunction): ModelParamsReadOnlyLabels => ({
  temp: t('lab.model.label.temp'),
  topP: t('lab.model.label.top-p'),
  maxTok: t('lab.model.label.max-tok'),
  freq: t('lab.model.label.freq'),
  pres: t('lab.model.label.pres'),
  contextSize: t('lab.model.label.context-size'),
  thinking: t('lab.model.toggle.thinking'),
  thinkingBudget: t('lab.model.label.thinking-budget'),
});

const buildMetricLabels = (t: TranslationFunction): CompareMetricLabels => ({
  latency: t('lab.compare.latency'),
  tps: t('lab.compare.tps'),
  perplexity: t('lab.compare.perplexity'),
  readability: t('lab.compare.readability'),
  lexicalDiversity: t('lab.compare.lexicalDiversity'),
  wordCount: t('lab.compare.wordCount'),
  sentenceCount: t('lab.compare.sentenceCount'),
  readingTime: t('lab.compare.readingTime'),
  sentiment: t('lab.compare.sentiment'),
  passiveVoiceRatio: t('lab.compare.passiveVoiceRatio'),
  questionDensity: t('lab.compare.questionDensity'),
  ngramRepetition: t('lab.compare.ngramRepetition'),
  namedEntityCount: t('lab.compare.namedEntityCount'),
  avgSentenceLength: t('lab.compare.avgSentenceLength'),
  hedgingDensity: t('lab.compare.hedgingDensity'),
});

const buildMetricTooltips = (t: TranslationFunction): Record<string, string> =>
  Object.fromEntries(
    METRIC_KEYS.map((key: string): readonly [string, string] => [
      key,
      t(`lab.metricTooltip.${key}`),
    ])
  );

const buildQualityLabels = (t: TranslationFunction): CompareQualityLabels => ({
  good: t('lab.compare.qualityGood'),
  average: t('lab.compare.qualityAverage'),
  bad: t('lab.compare.qualityBad'),
});

export const useCompareStrip = (): CompareStripProps => {
  const t = useTranslation();
  const { selectedCellIds, compareMode, cells, analyzingCellIds, setCompareMode } =
    usePromptTesterStore(
      useShallow(s => {
        const active = (s.runs as readonly RunTab[]).find(r => r.id === s.activeRunId);
        return {
          selectedCellIds: active?.selectedCellIds ?? [],
          compareMode: active?.compareMode ?? ('diff' as CompareMode),
          cells: active?.cells ?? [],
          analyzingCellIds: s.analyzingCellIds,
          setCompareMode: s.setCompareMode,
        };
      })
    );

  const { diffPanes, metricRows, cellCards } = buildCompareRows(
    cells,
    selectedCellIds,
    buildParamLabels(t),
    {
      temp: t('lab.compare.paramTemp'),
      topP: t('lab.compare.paramTopP'),
      thinking: t('lab.compare.paramThinking'),
      latency: t('lab.compare.paramLatency'),
      yes: t('lab.compare.yes'),
      no: t('lab.compare.no'),
    },
    buildMetricLabels(t),
    analyzingCellIds
  );

  return {
    mode: compareMode,
    modeLabels: {
      diff: t('lab.compare.diff'),
      table: t('lab.compare.table'),
      both: t('lab.compare.both'),
    },
    title: t('lab.compare.title'),
    diffPanes,
    metricRows,
    metricsHeaderLabel: t('lab.compare.metricsHeader'),
    estimateLabel: t('lab.compare.perplexityEstimateSuffix'),
    metricColAriaLabel: (label: string): string => t('lab.compare.metricCol', { label }),
    cellCards,
    metricTooltips: buildMetricTooltips(t),
    fieldInfoLabel: (label: string): string => t('lab.compare.fieldInfo', { label }),
    calculatingLabel: t('lab.compare.calculating'),
    qualityLabels: buildQualityLabels(t),
    isEmpty: selectedCellIds.length < MIN_COMPARE_CELLS,
    emptyStateLabel: t('lab.compare.emptyState'),
    onModeChange: setCompareMode,
  };
};
