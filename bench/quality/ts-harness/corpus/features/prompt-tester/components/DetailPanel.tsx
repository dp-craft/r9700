import { AlertCircle, ChevronDown, Loader2, RotateCcw, Star } from 'lucide-react';
import type * as React from 'react';

import { ReasoningPanel } from '@/components/reasoning-panel/ReasoningPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import type {
  DetailPanelVM,
  JudgeCriterionVM,
  JudgeEvaluationVM,
  RunAnalysisVM,
  StreamingResultVM,
  Tier1MetricsVM,
  Tier2MetricsVM
} from '../types';
import { ModelParamsReadOnlyBlock } from './ModelParamsReadOnlyBlock';

export interface DetailPanelLabels {
  readonly systemPromptSection: string;
  readonly responseSection: string;
  readonly performanceMetrics: string;
  readonly textAnalysis: string;
  readonly llmJudge: string;
  readonly judgeWithLlm: string;
  readonly overallScore: string;
  readonly overallReasoning: string;
  readonly analyze: string;
  readonly responseTime: string;
  readonly timeToFirstToken: string;
  readonly tps: string;
  readonly characterCount: string;
  readonly wordCount: string;
  readonly estimatedTokens: string;
  readonly codeBlocks: string;
  readonly structureScore: string;
  readonly lexicalDiversity: string;
  readonly repetitionScore: string;
  readonly readabilityGrade: string;
  readonly approximateSuffix: string;
  readonly rouge1: string;
  readonly rouge2: string;
  readonly bleu: string;
  readonly keywordPresence: string;
  readonly jaccardSimilarity: string;
  readonly statusWaiting: string;
  readonly statusStreamingResponse: string;
  readonly statusCompleted: string;
  readonly statusFailed: string;
  readonly statusAborted: string;
  readonly retry: string;
  readonly reasoning: string;
  readonly panelAria: string;
  readonly panelDescription: string;
  readonly analysisHeading?: string;
  readonly perplexity?: string;
  readonly perplexityEstimateSuffix?: string;
  readonly readability?: string;
  readonly sentenceCount?: string;
  readonly readingTime?: string;
  readonly furtherMeasurements?: string;
  readonly sentiment?: string;
  readonly passiveVoiceRatio?: string;
  readonly questionDensity?: string;
  readonly ngramRepetition?: string;
  readonly namedEntityCount?: string;
  readonly avgSentenceLength?: string;
  readonly hedgingDensity?: string;
}

const DEFAULT_DETAIL_LABELS: DetailPanelLabels = {
  systemPromptSection: 'System Prompt',
  responseSection: 'Response',
  performanceMetrics: 'Performance Metrics',
  textAnalysis: 'Text Analysis',
  llmJudge: 'LLM-as-Judge',
  judgeWithLlm: 'Judge with LLM',
  overallScore: 'Overall Score',
  overallReasoning: 'Overall Reasoning',
  analyze: 'Analyze',
  responseTime: 'Response Time',
  timeToFirstToken: 'Time to First Token',
  tps: 'TPS',
  characterCount: 'Character Count',
  wordCount: 'Word Count',
  estimatedTokens: 'Estimated Tokens',
  codeBlocks: 'Code Blocks',
  structureScore: 'Structure Score',
  lexicalDiversity: 'Lexical Diversity',
  repetitionScore: 'Repetition Score',
  readabilityGrade: 'Readability Grade',
  approximateSuffix: '(approximate)',
  rouge1: 'ROUGE-1',
  rouge2: 'ROUGE-2',
  bleu: 'BLEU',
  keywordPresence: 'Keyword Presence',
  jaccardSimilarity: 'Jaccard Similarity',
  statusWaiting: 'Waiting for execution...',
  statusStreamingResponse: 'Streaming response...',
  statusCompleted: 'Completed',
  statusFailed: 'Failed',
  statusAborted: 'Aborted',
  retry: 'Retry',
  reasoning: 'Reasoning',
  panelAria: 'Test result details',
  panelDescription: 'Detailed view of test result metrics and response',
  analysisHeading: 'Run Analysis',
  perplexity: 'Perplexity',
  perplexityEstimateSuffix: '(estimate)',
  readability: 'Readability Grade',
  sentenceCount: 'Sentence Count',
  readingTime: 'Reading Time',
  furtherMeasurements: 'Further Measurements',
  sentiment: 'Sentiment',
  passiveVoiceRatio: 'Passive Voice',
  questionDensity: 'Question Density',
  ngramRepetition: 'n-gram TF-IDF repetition',
  namedEntityCount: 'Named Entities',
  avgSentenceLength: 'Avg Sentence Length',
  hedgingDensity: 'Hedging Density',
};

export interface DetailPanelProps extends DetailPanelVM {
  readonly labels?: Partial<DetailPanelLabels>;
  readonly className?: string;
  readonly onRetry?: () => void;
  readonly runAnalysis?: RunAnalysisVM | null;
}

type Status = StreamingResultVM['status'];

const JUDGE_SCALE_MAX = 4;

const formatTier2Perplexity = (perplexity: number | null): string =>
  perplexity === null ? '—' : perplexity.toFixed(1);

const formatDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

const formatPercentage = (value: number): string => `${Math.round(value * 100)}%`;

const formatJudgeScore = (score: number): string => `${score}/${JUDGE_SCALE_MAX}`;

function getStatusLabel(status: Status, labels: DetailPanelLabels): string {
  if (status === 'pending') return labels.statusWaiting;
  if (status === 'streaming') return labels.statusStreamingResponse;
  if (status === 'completed') return labels.statusCompleted;
  if (status === 'failed') return labels.statusFailed;
  return labels.statusAborted;
}

function getJudgeScoreVariant(score: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (score >= 4) return 'default';
  if (score >= 3) return 'secondary';
  if (score >= 2) return 'outline';
  return 'destructive';
}

function SectionHeading({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return <h3 className="text-sm font-semibold tracking-tight">{children}</h3>;
}

function MetricCell({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function SystemPromptSection({
  systemPrompt,
  heading,
}: {
  readonly systemPrompt: string;
  readonly heading: string;
}): React.ReactElement {
  return (
    <section aria-label={heading}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
          <SectionHeading>{heading}</SectionHeading>
          <ChevronDown
            className="text-muted-foreground h-4 w-4 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
          {systemPrompt}
        </pre>
      </details>
    </section>
  );
}

function ResponseStatusIndicator({
  status,
  label,
}: {
  readonly status: Status;
  readonly label: string;
}): React.ReactElement {
  const isStreaming = status === 'streaming';

  return (
    <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
      {isStreaming && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      <span>{label}</span>
    </div>
  );
}

function ErrorAlert({ error }: { readonly error: string }): React.ReactElement {
  return (
    <div
      className="bg-destructive/10 text-destructive border-destructive/30 flex items-start gap-2 rounded-md border p-3 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{error}</span>
    </div>
  );
}

function ResponseSection({
  responseText,
  status,
  error,
  labels,
  onRetry,
}: {
  readonly responseText: string;
  readonly status: Status;
  readonly error: string | null;
  readonly labels: DetailPanelLabels;
  readonly onRetry?: () => void;
}): React.ReactElement {
  const showStatusIndicator = status === 'pending' || status === 'streaming';
  const hasResponse = responseText.length > 0;
  const hasError = error !== null;
  const statusLabel = getStatusLabel(status, labels);

  return (
    <section aria-label={labels.responseSection}>
      <SectionHeading>{labels.responseSection}</SectionHeading>
      <div className="mt-2 space-y-2">
        {hasError && (
          <div className="space-y-2">
            <ErrorAlert error={error} />
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} aria-label={labels.retry}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {labels.retry}
              </Button>
            )}
          </div>
        )}
        {showStatusIndicator && <ResponseStatusIndicator status={status} label={statusLabel} />}
        {hasResponse && (
          <pre className="bg-muted max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
            {responseText}
          </pre>
        )}
      </div>
    </section>
  );
}

function Tier1Section({
  tier1,
  tps,
  labels,
}: {
  readonly tier1: Tier1MetricsVM;
  readonly tps: number | null;
  readonly labels: DetailPanelLabels;
}): React.ReactElement {
  return (
    <section aria-label={labels.performanceMetrics}>
      <SectionHeading>{labels.performanceMetrics}</SectionHeading>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <MetricCell label={labels.responseTime} value={formatDuration(tier1.responseTimeMs)} />
        <MetricCell
          label={labels.timeToFirstToken}
          value={formatDuration(tier1.timeToFirstTokenMs)}
        />
        {tps !== null && <MetricCell label={labels.tps} value={tps.toFixed(1)} />}
        <MetricCell label={labels.characterCount} value={String(tier1.charCount)} />
        <MetricCell label={labels.wordCount} value={String(tier1.wordCount)} />
        <MetricCell label={labels.estimatedTokens} value={String(tier1.estimatedTokens)} />
        <MetricCell label={labels.codeBlocks} value={String(tier1.codeBlockCount)} />
        <MetricCell label={labels.structureScore} value={formatPercentage(tier1.structureScore)} />
      </div>
    </section>
  );
}

function Tier2Section({
  tier2,
  isAnalyzing,
  onAnalyzeTier2,
  labels,
}: {
  readonly tier2: Tier2MetricsVM | null;
  readonly isAnalyzing: boolean;
  readonly onAnalyzeTier2: () => void;
  readonly labels: DetailPanelLabels;
}): React.ReactElement {
  if (tier2 === null) {
    return (
      <section aria-label={labels.textAnalysis}>
        <SectionHeading>{labels.textAnalysis}</SectionHeading>
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isAnalyzing}
            onClick={onAnalyzeTier2}
            aria-label={labels.analyze}
          >
            {isAnalyzing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {labels.analyze}
          </Button>
        </div>
      </section>
    );
  }

  const readabilityLabel = tier2.readabilityApproximate
    ? `${tier2.readabilityGrade.toFixed(1)} ${labels.approximateSuffix}`
    : tier2.readabilityGrade.toFixed(1);

  const referenceMetrics = buildReferenceMetrics(tier2, labels);

  return (
    <section aria-label={labels.textAnalysis}>
      <SectionHeading>{labels.textAnalysis}</SectionHeading>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <MetricCell
          label={labels.lexicalDiversity}
          value={formatPercentage(tier2.lexicalDiversity)}
        />
        <MetricCell
          label={labels.repetitionScore}
          value={formatPercentage(tier2.repetitionScore)}
        />
        <MetricCell label={labels.readabilityGrade} value={readabilityLabel} />
        {referenceMetrics.map(metric => (
          <MetricCell key={metric.label} label={metric.label} value={metric.value} />
        ))}
        <div className="flex flex-col gap-0.5" data-testid="analysis-perplexity">
          <span className="text-muted-foreground text-xs">{labels.perplexity}</span>
          <span className="text-sm font-medium">{formatTier2Perplexity(tier2.perplexity)}</span>
        </div>
      </div>
    </section>
  );
}

interface ReferenceMetric {
  readonly label: string;
  readonly value: string;
}

function buildReferenceMetrics(
  tier2: Tier2MetricsVM,
  labels: DetailPanelLabels
): readonly ReferenceMetric[] {
  const metrics: ReferenceMetric[] = [];

  if (tier2.rouge1 !== null) {
    metrics.push({ label: labels.rouge1, value: formatPercentage(tier2.rouge1) });
  }
  if (tier2.rouge2 !== null) {
    metrics.push({ label: labels.rouge2, value: formatPercentage(tier2.rouge2) });
  }
  if (tier2.bleu !== null) {
    metrics.push({ label: labels.bleu, value: formatPercentage(tier2.bleu) });
  }
  if (tier2.keywordPresence !== null) {
    metrics.push({ label: labels.keywordPresence, value: formatPercentage(tier2.keywordPresence) });
  }
  if (tier2.jaccardSimilarity !== null) {
    metrics.push({
      label: labels.jaccardSimilarity,
      value: formatPercentage(tier2.jaccardSimilarity),
    });
  }

  return metrics;
}

function buildPerplexityText(perplexity: number, suffix: string): string {
  return `${perplexity.toFixed(1)} ${suffix}`;
}

interface FurtherMeasurement {
  readonly label: string;
  readonly value: string;
}

const formatNullableDecimal = (value: number | null): string =>
  value === null ? '—' : value.toFixed(1);

const formatNullableCount = (value: number | null): string =>
  value === null ? '—' : String(value);

function buildFurtherMeasurements(
  tier2: Tier2MetricsVM,
  labels: DetailPanelLabels
): readonly FurtherMeasurement[] {
  return [
    { label: labels.sentiment ?? '', value: formatNullableDecimal(tier2.sentiment) },
    {
      label: labels.passiveVoiceRatio ?? '',
      value: formatNullableDecimal(tier2.passiveVoiceRatio),
    },
    { label: labels.questionDensity ?? '', value: formatNullableDecimal(tier2.questionDensity) },
    { label: labels.ngramRepetition ?? '', value: formatPercentage(tier2.repetitionScore) },
    { label: labels.namedEntityCount ?? '', value: formatNullableCount(tier2.namedEntityCount) },
    {
      label: labels.avgSentenceLength ?? '',
      value: formatNullableDecimal(tier2.avgSentenceLength),
    },
    { label: labels.hedgingDensity ?? '', value: formatNullableDecimal(tier2.hedgingDensity) },
  ];
}

function FurtherMeasurementsSection({
  tier2,
  labels,
}: {
  readonly tier2: Tier2MetricsVM | null;
  readonly labels: DetailPanelLabels;
}): React.ReactElement | null {
  if (tier2 === null) {
    return null;
  }

  const heading = labels.furtherMeasurements ?? '';
  const measurements = buildFurtherMeasurements(tier2, labels);

  return (
    <section aria-label={heading} data-testid="analysis-further-measurements">
      <SectionHeading>{heading}</SectionHeading>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {measurements.map(metric => (
          <MetricCell key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>
    </section>
  );
}

function RunAnalysisSection({
  runAnalysis,
  labels,
}: {
  readonly runAnalysis: RunAnalysisVM | null;
  readonly labels: DetailPanelLabels;
}): React.ReactElement | null {
  if (runAnalysis === null) {
    return null;
  }

  const analysisHeading = labels.analysisHeading ?? DEFAULT_DETAIL_LABELS.analysisHeading ?? '';
  const perplexityLabel = labels.perplexity ?? DEFAULT_DETAIL_LABELS.perplexity ?? '';
  const estimateSuffix =
    labels.perplexityEstimateSuffix ?? DEFAULT_DETAIL_LABELS.perplexityEstimateSuffix ?? '';
  const readabilityLabel = labels.readability ?? DEFAULT_DETAIL_LABELS.readability ?? '';
  const sentenceCountLabel = labels.sentenceCount ?? DEFAULT_DETAIL_LABELS.sentenceCount ?? '';
  const readingTimeLabel = labels.readingTime ?? DEFAULT_DETAIL_LABELS.readingTime ?? '';
  const perplexityText = buildPerplexityText(runAnalysis.perplexity, estimateSuffix);

  return (
    <section aria-label={analysisHeading} data-testid="analysis-measurements">
      <SectionHeading>{analysisHeading}</SectionHeading>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <MetricCell label={readabilityLabel} value={runAnalysis.readabilityGrade.toFixed(1)} />
        <MetricCell label={labels.wordCount} value={String(runAnalysis.wordCount)} />
        <MetricCell label={sentenceCountLabel} value={String(runAnalysis.sentenceCount)} />
        <MetricCell label={readingTimeLabel} value={runAnalysis.readingTimeMinutes.toFixed(1)} />
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">{perplexityLabel}</span>
          <output data-testid="perplexity-value" className="text-sm font-medium">
            {perplexityText}
          </output>
        </div>
      </div>
    </section>
  );
}

function CriterionItem({
  criterion,
}: {
  readonly criterion: JudgeCriterionVM;
}): React.ReactElement {
  const variant = getJudgeScoreVariant(criterion.score);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{criterion.name}</span>
        <Badge variant={variant} className="text-xs">
          {formatJudgeScore(criterion.score)}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">{criterion.reasoning}</p>
    </div>
  );
}

function JudgeSection({
  judge,
  isJudging,
  onRunJudge,
  labels,
}: {
  readonly judge: JudgeEvaluationVM | null;
  readonly isJudging: boolean;
  readonly onRunJudge: () => void;
  readonly labels: DetailPanelLabels;
}): React.ReactElement {
  if (judge === null) {
    return (
      <section aria-label={labels.llmJudge}>
        <SectionHeading>{labels.llmJudge}</SectionHeading>
        <div className="mt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isJudging}
            onClick={onRunJudge}
            aria-label={labels.judgeWithLlm}
          >
            {isJudging && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <Star className="h-4 w-4" aria-hidden="true" />
            {labels.judgeWithLlm}
          </Button>
        </div>
      </section>
    );
  }

  const hasError = judge.error !== null;
  const hasScore = judge.score !== null;
  const scoreVariant = hasScore ? getJudgeScoreVariant(judge.score) : 'secondary';
  const hasCriteria = judge.criteria.length > 0;
  const hasReasoning = judge.overallReasoning.length > 0;

  return (
    <section aria-label={labels.llmJudge}>
      <SectionHeading>{labels.llmJudge}</SectionHeading>
      <div className="mt-2 space-y-3">
        {hasError && <ErrorAlert error={judge.error as string} />}

        {hasScore && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{labels.overallScore}</span>
            <Badge variant={scoreVariant} className="px-3 py-1 text-base">
              {formatJudgeScore(judge.score as number)}
            </Badge>
          </div>
        )}

        {hasCriteria && (
          <div className="space-y-3">
            {judge.criteria.map(criterion => (
              <CriterionItem key={criterion.name} criterion={criterion} />
            ))}
          </div>
        )}

        {hasReasoning && (
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs font-medium">
              {labels.overallReasoning}
            </span>
            <p className="bg-muted rounded-md p-3 text-xs whitespace-pre-wrap">
              {judge.overallReasoning}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function DetailPanel({
  isOpen,
  title,
  cellKey: _cellKey,
  systemPrompt,
  responseText,
  status,
  error,
  tier1,
  tier2,
  judge,
  isAnalyzing,
  isJudging,
  tps,
  modelParams,
  reasoning,
  onClose,
  onAnalyzeTier2,
  onRunJudge,
  onRetry,
  labels,
  className,
  runAnalysis,
}: DetailPanelProps): React.ReactElement {
  const l = { ...DEFAULT_DETAIL_LABELS, ...labels };
  const hasSystemPrompt = systemPrompt !== null;
  const hasTier1 = tier1 !== null;
  const analysis = runAnalysis ?? null;
  const hasRunAnalysis = analysis !== null;
  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange(onClose)}>
      <SheetContent side="right" className={cn('sm:max-w-lg', className)} aria-label={l.panelAria}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{l.panelDescription}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <div className="space-y-4">
            {hasSystemPrompt && (
              <SystemPromptSection
                systemPrompt={systemPrompt as string}
                heading={l.systemPromptSection}
              />
            )}

            <ReasoningPanel reasoning={reasoning ?? ''} title={l.reasoning} />

            <Separator />

            <ResponseSection
              responseText={responseText}
              status={status}
              error={error}
              labels={l}
              onRetry={onRetry}
            />

            {hasTier1 && (
              <>
                <Separator />
                <Tier1Section tier1={tier1} tps={tps} labels={l} />
              </>
            )}

            {hasRunAnalysis && (
              <>
                <Separator />
                <RunAnalysisSection runAnalysis={analysis} labels={l} />
              </>
            )}

            {modelParams !== null && (
              <>
                <Separator />
                <ModelParamsReadOnlyBlock {...modelParams} />
              </>
            )}

            <Separator />

            <Tier2Section
              tier2={tier2}
              isAnalyzing={isAnalyzing}
              onAnalyzeTier2={onAnalyzeTier2}
              labels={l}
            />

            {tier2 !== null && (
              <>
                <Separator />
                <FurtherMeasurementsSection tier2={tier2} labels={l} />
              </>
            )}

            <Separator />

            <JudgeSection judge={judge} isJudging={isJudging} onRunJudge={onRunJudge} labels={l} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function handleOpenChange(onClose: () => void): (open: boolean) => void {
  return (open: boolean) => {
    if (!open) {
      onClose();
    }
  };
}
