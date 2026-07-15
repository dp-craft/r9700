import type { PointerEvent as ReactPointerEvent } from 'react';

import type { EvalComparisonDTO, JudgeEvaluationDTO, PromptHistoryEntry, Tier2MetricsDTO } from '@/db/idb';
import type { TestInLabPayload } from '@/domain/cross-mf';
import type { AtomicSkillDTO, PromptTesterMode } from '@/domain/entities';
import type { PickerHistoryItem } from '@/domain/picker-history';
import type { ParallelismMode } from '@/domain/run-controls';

import type { PerplexityBand } from './utils/perplexityQuality';

export type { PromptTesterMode };
export type PromptPickerTab = 'skills' | 'packages' | 'history' | 'blank';

export interface TestRunConfig {
  readonly userPrompt: string;
  readonly systemPrompts: readonly string[];
  readonly model: string;
}

export interface ScratchTab {
  readonly id: `scratch-${string}`;
  readonly source: 'chat-deep-link';
  readonly sourceSessionId: string;
  readonly config: TestRunConfig;
  readonly persisted: false;
}

// ---------------------------------------------------------------------------
// LabState types (025 Design-Spec Alignment)
// ---------------------------------------------------------------------------

export type SliderValues = {
  readonly temp: number;
  readonly topP: number;
  readonly maxTok: number;
  readonly freq: number;
  readonly pres: number;
  readonly contextSize?: number;
};

export type ModelEntry = {
  readonly id: string;
  readonly providerId: string;
  readonly modelKey: string;
  readonly name: string;
  readonly params: SliderValues;
  readonly thinking: boolean;
  readonly supportsThinking: boolean;
  readonly expanded: boolean;
  readonly accent: boolean;
  readonly axisId?: number;
};

export type PromptEntry = {
  readonly id: string;
  readonly kind: 'skill' | 'custom' | 'history';
  readonly skillId?: string;
  readonly containerId?: string;
  readonly text: string;
  readonly edited: boolean;
  readonly axisId?: number;
};

/** Synthetic prompt id for the zero-prompt (user-prompt-only) run path. */
export const IMPLICIT_PROMPT_ID = '__empty__';

export type CellStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

export type RatingCategoryId = 'accuracy' | 'style' | 'tone' | 'length' | 'readability';

export type CellRatings = Readonly<Record<RatingCategoryId, number>>;

export type ResolvedModelSnapshot = {
  readonly name: string;
  readonly providerId: string;
  readonly modelKey: string;
  readonly params: SliderValues;
  readonly thinking: boolean;
};

export type CellResult = {
  readonly id: string;
  readonly modelId: string;
  readonly promptId: string;
  readonly userPromptHash: string;
  readonly output: string;
  readonly latencyMs: number;
  readonly tokens: number;
  readonly cost: number;
  readonly ratings: CellRatings;
  readonly cached: boolean;
  readonly status: CellStatus;
  readonly error?: string;
  readonly ttfMs?: number;
  readonly tps?: number;
  readonly resolvedModel?: ResolvedModelSnapshot;
  readonly resolvedSkillText?: string;
  readonly resolvedSkillLabel?: string;
  readonly reasoning?: string;
  readonly tier2?: Tier2MetricsDTO | null;
  readonly judge?: JudgeEvaluationDTO | null;
};

export type SortKey = 'mean' | 'latency' | 'tokens' | 'cost';
export type GroupKey = 'none' | 'model' | 'system';
export type GridCols = 2 | 3 | 4;
export type CompareMode = 'diff' | 'table' | 'both';
export type SectionId = 'modellek' | 'systemSkill' | 'userPrompt';

export type ArchivedRunInput = {
  readonly id: string;
  readonly label: string;
  readonly configSnapshot: ConfigSnapshot;
};

export type ConfigSnapshot = {
  readonly models: readonly ModelEntry[];
  readonly prompts: readonly PromptEntry[];
  readonly userPrompt: string;
};

export type RunTab = {
  readonly id: number;
  readonly label: string;
  readonly createdAt: number;
  readonly configSnapshot: ConfigSnapshot;
  readonly cells: readonly CellResult[];
  readonly selectedCellIds: readonly string[];
  readonly compareMode: CompareMode;
  readonly sort: SortKey;
  readonly group: GroupKey;
  readonly gridCols: GridCols;
  readonly viewMode: 'list' | 'grid';
  readonly evalComparison?: EvalComparisonDTO | null;
};

export type LabState = {
  readonly models: readonly ModelEntry[];
  readonly prompts: readonly PromptEntry[];
  readonly userPrompt: string;
  readonly runs: readonly RunTab[];
  readonly activeRunId: number;
  readonly sectionCollapse: Readonly<Record<SectionId, boolean>>;
  readonly streaming: { readonly runId: number | null; readonly cellIds: readonly string[] };
  readonly activeDetailCellId: string | null;
  readonly pickerOpen: boolean;
  readonly pickerHistory: readonly PickerHistoryItem[];
  readonly editingRunId: string | null;
  readonly editingPromptId: string | null;
  readonly confirmingRemoveModelId: string | null;
  readonly mode: PromptTesterMode;
  readonly modelPickerOpen: boolean;
  readonly userPromptHistoryOpen: boolean;
  readonly userPromptHistoryItems: readonly PromptHistoryEntry[];
  readonly pickerActiveTab: PromptPickerTab;
  readonly pickerHistoryEntries: readonly PromptHistoryEntry[];
  readonly _pendingScratch: TestInLabPayload | null;
  readonly runHistoryLoaded: boolean;
  readonly runParallel: boolean;
  readonly parallelismMode: ParallelismMode;
  readonly compareSplitRatio: number;
  readonly analyzingCellIds: readonly string[];
  readonly judgingCellId: string | null;
};

export interface CompareSplit {
  readonly ratio: number;
  readonly onResizeStart: (e: ReactPointerEvent) => void;
}

export type SystemPromptInput =
  | {
    readonly kind: 'skill';
    readonly skillId: string;
    readonly name: string;
    readonly prompt: string;
  }
  | { readonly kind: 'container'; readonly containerId: string; readonly prompt: string }
  | { readonly kind: 'history'; readonly runId: string; readonly prompt: string }
  | { readonly kind: 'blank'; readonly prompt?: string };

export type LabStoreActions = {
  readonly setCompareSplitRatio: (ratio: number) => void;
  readonly addModel: (input: {
    readonly providerId: string;
    readonly modelKey: string;
    readonly name: string;
    readonly supportsThinking: boolean;
  }) => void;
  readonly removeModel: (modelId: string) => void;
  readonly setModelParam: (modelId: string, key: keyof SliderValues, value: number) => void;
  readonly clampModelParam: (modelId: string, key: keyof SliderValues) => void;
  readonly toggleModelThinking: (modelId: string) => void;
  readonly toggleModelExpanded: (modelId: string) => void;

  readonly addSystemPromptToActiveRun: (input: SystemPromptInput) => void;
  readonly addPrompt: (entry: PromptEntry) => void;
  readonly removePrompt: (promptId: string) => void;
  readonly editPrompt: (promptId: string, text: string) => void;

  readonly setUserPrompt: (text: string) => void;

  readonly toggleSection: (id: SectionId) => void;
  readonly loadSectionCollapse: () => Promise<void>;

  readonly setRunParallel: (v: boolean) => void;
  readonly setParallelismMode: (m: ParallelismMode) => void;
  readonly loadParallelRunsSettings: () => Promise<void>;
  readonly runChanged: () => Promise<void>;
  readonly hasOutdatedCells: () => boolean;

  readonly runFull: () => Promise<void>;
  readonly runPartial: () => Promise<void>;
  readonly abortRun: () => void;
  readonly forkRun: () => void;
  readonly setActiveRun: (id: number) => void;
  readonly renameRun: (id: number, label: string) => void;

  readonly toggleCellSelection: (cellId: string) => boolean;
  readonly setCompareMode: (mode: CompareMode) => void;

  readonly setSort: (key: SortKey) => void;
  readonly setGroup: (key: GroupKey) => void;
  readonly setGridCols: (n: GridCols) => void;
  readonly setViewMode: (viewMode: 'list' | 'grid') => void;

  readonly setCellScore: (
    cellId: string,
    categoryId: RatingCategoryId,
    value: 0 | 1 | 2 | 3 | 4 | 5
  ) => void;

  readonly loadRunHistory: () => Promise<void>;
  readonly deleteRun: (id: number) => Promise<void>;
  readonly persistActiveRun: () => Promise<void>;

  readonly createEmptyTab: () => void;
  readonly closeTab: (id: number) => Promise<void>;

  readonly openScratchTab: (payload: TestInLabPayload) => void;
  readonly openArchivedRun: (archived: ArchivedRunInput) => void;
  readonly openArchivedRunById: (id: string) => Promise<void>;

  readonly openDetailFor: (cellId: string) => void;
  readonly closeDetail: () => void;

  readonly openPicker: (skills: readonly AtomicSkillDTO[]) => Promise<void>;
  readonly closePicker: () => void;

  readonly setEditingRun: (id: string | null) => void;
  readonly setEditingPrompt: (promptId: string | null) => void;
  readonly setConfirmingRemoveModel: (id: string | null) => void;

  readonly setMode: (mode: PromptTesterMode) => void;

  readonly openModelPicker: () => void;
  readonly closeModelPicker: () => void;
  readonly confirmModelPicker: (input: {
    readonly providerId: string;
    readonly modelKey: string;
    readonly name: string;
    readonly supportsThinking: boolean;
  }) => void;

  readonly loadUserPromptHistory: () => Promise<void>;
  readonly selectUserPromptHistory: (text: string) => void;
  readonly setUserPromptHistoryOpen: (open: boolean) => void;

  readonly setPickerActiveTab: (tab: PromptPickerTab) => void;
  readonly loadPickerHistory: () => Promise<void>;

  readonly archiveAndCreateEmptyTab: () => Promise<void>;

  readonly isRunDisabled: () => boolean;
  readonly retryCell: (cellId: string) => Promise<void>;
  readonly deleteCell: (cellId: string) => Promise<void>;

  readonly analyzeRunCells: (runId: number) => Promise<void>;
  readonly analyzeCell: (cellId: string) => Promise<void>;
  readonly runJudge: (cellId: string) => Promise<void>;
  readonly evaluateRunOutputs: (runId: number) => Promise<void>;
  readonly getEvalComparisonPrompt: (runId: number) => string;
  readonly runEvalComparison: (runId: number) => Promise<void>;
};

export type LabStore = LabState & LabStoreActions;

// ---------------------------------------------------------------------------
// Compare VM types (placed here to prevent util→renderer import direction violation)
// ---------------------------------------------------------------------------

export interface CompareParamRow {
  readonly label: string;
  readonly values: readonly string[];
}

export interface CompareMetricRow {
  readonly metricKey: string;
  readonly label: string;
  readonly values: readonly string[];
  readonly isEstimate: boolean;
  /**
   * Per-cell quality band (aligned with `values`), present only on the
   * `perplexity-true` row. `undefined` per entry when that cell has no numeric
   * perplexity (fallback / analyzing). Absent on all other metric rows.
   */
  readonly qualities?: readonly (PerplexityBand | undefined)[];
}

export interface CompareCellVM {
  readonly label: string;
  readonly modelParams: ModelParamsReadOnlyBlockProps;
}

// ---------------------------------------------------------------------------
// ResultsGrid VM type (placed here to prevent util→renderer import direction violation)
// ---------------------------------------------------------------------------

export type ResultCellVM = {
  readonly id: string;
  readonly title: string;
  readonly modelLabel: string;
  readonly phrase: string;
  readonly warning?: 'unresolved';
  readonly status: 'idle' | 'streaming' | 'done' | 'error' | 'aborted';
  readonly outputPreview: string;
  readonly error: string | null;
  readonly latencyMs: number;
  readonly tokens: number;
  readonly ttfMs: number | null;
  readonly tps: number | null;
  readonly isOutdated: boolean;
  readonly reasoning?: string;
  // Full output text (needed for run-analysis-derived quality stars).
  readonly output: string;
  // Mean of the cell's per-category ratings (0..5 scale); 0 when no ratings.
  readonly meanRating: number;
  readonly ratings?: CellRatings;
};

export type StarMetricId = 'fluency' | 'readability' | 'vocabulary';

export type StarRow = {
  readonly category: StarMetricId;
  readonly score: number;
};

export type GridCellVM = {
  readonly id: string;
  readonly cell: ResultCellVM;
  readonly selected: boolean;
  readonly starRows: readonly StarRow[];
  readonly tps: number | null;
  readonly timeToFirstTokenMs: number | null;
};

export interface GridTableModelColumn {
  readonly modelId: string;
  readonly label: string;
}

export interface GridTableSkillRow {
  readonly skillKey: string;
  readonly label: string;
  // 1:1 aligned with GridTableVM.modelColumns; null = no result for that model×skill combo
  readonly cells: readonly (GridCellVM | null)[];
}

export interface GridTableVM {
  readonly modelColumns: readonly GridTableModelColumn[];
  readonly skillRows: readonly GridTableSkillRow[];
}

// ---------------------------------------------------------------------------
// Legacy VM types (still consumed by existing containers)
// ---------------------------------------------------------------------------

export type AxisVariableTypeVM = 'models' | 'skill-containers' | 'custom-system-prompts';

export interface AxisValueVM {
  readonly id: string;
  readonly label: string;
  readonly providerId: string | null;
}

export interface AxisConfigVM {
  readonly type: AxisVariableTypeVM;
  readonly values: readonly AxisValueVM[];
}

export interface ModelOptionVM {
  readonly id: string;
  readonly modelKey: string;
  readonly name: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly supportsThinking: boolean;
}

export interface ModelGroupVM {
  readonly providerName: string;
  readonly models: readonly ModelOptionVM[];
}

export interface ContainerOptionVM {
  readonly id: string;
  readonly name: string;
}

export interface Tier1MetricsVM {
  readonly responseTimeMs: number;
  readonly timeToFirstTokenMs: number;
  readonly charCount: number;
  readonly wordCount: number;
  readonly estimatedTokens: number;
  readonly codeBlockCount: number;
  readonly structureScore: number;
}

export interface StreamingResultVM {
  readonly status: 'pending' | 'streaming' | 'completed' | 'failed' | 'aborted';
  readonly responseText: string;
  readonly error: string | null;
  readonly tier1: Tier1MetricsVM | null;
}

export interface ResultCardVM {
  readonly cellKey: string;
  readonly streaming: StreamingResultVM;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
}

export interface ResultGridVM {
  readonly rowLabels: readonly string[];
  readonly columnLabels: readonly string[] | null;
  readonly cells: readonly ResultCardVM[];
  readonly onHeaderClick: (label: string, fullText: string) => void;
}

export interface SystemPromptEntryVM {
  readonly id: string;
  readonly source: 'container' | 'custom' | 'skill';
  readonly label: string;
  readonly systemPrompt: string;
  readonly skillId?: string;
}

export interface ConfigPanelVM {
  readonly userPrompt: string;
  readonly referenceAnswer: string;
  readonly combinationCount: number;
  readonly isRunning: boolean;
  readonly isRunDisabled: boolean;
  readonly warningLevel: 'none' | 'warning' | 'blocked';
  readonly onUserPromptChange: (text: string) => void;
  readonly onReferenceAnswerChange: (text: string) => void;
  readonly onRunTest: () => void;
  readonly onAbortTest: () => void;
}

export interface RunAnalysisVM {
  readonly wordCount: number;
  readonly sentenceCount: number;
  readonly readingTimeMinutes: number;
  readonly perplexity: number;
  readonly lexicalDiversity: number;
  readonly readabilityGrade: number;
}

export interface Tier2MetricsVM {
  readonly lexicalDiversity: number;
  readonly repetitionScore: number;
  readonly readabilityGrade: number;
  readonly readabilityApproximate: boolean;
  readonly rouge1: number | null;
  readonly rouge2: number | null;
  readonly bleu: number | null;
  readonly keywordPresence: number | null;
  readonly jaccardSimilarity: number | null;
  readonly perplexity: number | null;
  readonly sentiment: number | null;
  readonly passiveVoiceRatio: number | null;
  readonly questionDensity: number | null;
  readonly avgSentenceLength: number | null;
  readonly hedgingDensity: number | null;
  readonly namedEntityCount: number | null;
}

export interface JudgeCriterionVM {
  readonly name: string;
  readonly score: number;
  readonly reasoning: string;
}

export interface JudgeEvaluationVM {
  readonly score: number | null;
  readonly criteria: readonly JudgeCriterionVM[];
  readonly overallReasoning: string;
  readonly error: string | null;
}

export interface MetricsBadgeVM {
  readonly responseTimeMs: number | null;
  readonly estimatedTokens: number | null;
  readonly structureScore: number | null;
  readonly judgeScore: number | null;
}

export interface JudgeScoreBadgeVM {
  readonly score: number | null;
  readonly isLoading?: boolean;
  readonly error?: string | null;
}

export type HistoryEntryStatus = 'completed' | 'partial' | 'aborted';

export interface HistoryEntryVM {
  readonly id: string;
  readonly promptPreview: string;
  readonly createdAt: string;
  readonly axisDescription: string;
  readonly combinationCount: number;
  readonly avgJudgeScore: number | null;
  readonly status: HistoryEntryStatus;
}

export interface ModelParamsReadOnlyLabels {
  readonly temp: string;
  readonly topP: string;
  readonly maxTok: string;
  readonly freq: string;
  readonly pres: string;
  readonly contextSize: string;
  readonly thinking: string;
  readonly thinkingBudget: string;
}

export interface ModelParamsReadOnlyBlockProps {
  readonly params: SliderValues;
  readonly supportsThinking: boolean;
  readonly thinking: boolean;
  readonly thinkingBudget?: number;
  readonly labels: ModelParamsReadOnlyLabels;
  readonly className?: string;
}

export interface DetailPanelVM {
  readonly isOpen: boolean;
  readonly title: string;
  readonly cellKey: string | null;
  readonly systemPrompt: string | null;
  readonly responseText: string;
  readonly status: StreamingResultVM['status'];
  readonly error: string | null;
  readonly tier1: Tier1MetricsVM | null;
  readonly tier2: Tier2MetricsVM | null;
  readonly judge: JudgeEvaluationVM | null;
  readonly isAnalyzing: boolean;
  readonly isJudging: boolean;
  readonly tps: number | null;
  readonly modelParams: ModelParamsReadOnlyBlockProps | null;
  readonly reasoning?: string;
  readonly onClose: () => void;
  readonly onAnalyzeTier2: () => void;
  readonly onRunJudge: () => void;
}
