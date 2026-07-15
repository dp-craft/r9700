// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi
    .fn()
    .mockResolvedValue({ modellek: false, systemSkill: false, userPrompt: false }),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(undefined),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn().mockResolvedValue([]),
  archiveRun: vi.fn().mockResolvedValue(undefined),
  deleteArchivedRuns: vi.fn().mockResolvedValue(undefined),
  buildRunExport: vi.fn().mockReturnValue([]),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => 'en',
}));

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tier2MetricsDTO } from '@/db/idb';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import type { CellResult, RunTab } from '../../types';
import { DetailPanelContainer } from '../DetailPanelContainer';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS = { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 };
const DEFAULT_RATINGS = { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 };
const TIER2_DTO: Tier2MetricsDTO = {
  lexicalDiversity: 0.72,
  repetitionScore: 0.15,
  readabilityGrade: 8.4,
  readabilityApproximate: false,
  rouge1: null,
  rouge2: null,
  bleu: null,
  keywordPresence: null,
  jaccardSimilarity: null,
  perplexity: 42.7,
  sentiment: 0.3,
  passiveVoiceRatio: 0.1,
  questionDensity: 0.05,
  avgSentenceLength: 14.2,
  hedgingDensity: 0.08,
  namedEntityCount: 3,
};

function buildDoneCell(id: string, overrides: Partial<CellResult> = {}): CellResult {
  return {
    id,
    modelId: 'model-1',
    promptId: 'prompt-1',
    userPromptHash: 'hash-1',
    output: 'Hello world response',
    latencyMs: 500,
    tokens: 12,
    cost: 0.001,
    ratings: DEFAULT_RATINGS,
    cached: false,
    status: 'done',
    ...overrides,
  };
}

function buildRun(overrides: Partial<RunTab> = {}): RunTab {
  return {
    id: 1,
    label: 'Run 1',
    createdAt: 0,
    configSnapshot: {
      models: [
        {
          id: 'model-1',
          providerId: 'openai',
          modelKey: 'gpt-4o',
          name: 'GPT-4o',
          params: DEFAULT_PARAMS,
          thinking: false,
          supportsThinking: false,
          expanded: false,
          accent: false,
        },
      ],
      prompts: [{ id: 'prompt-1', text: 'Hello', kind: 'custom', edited: false }],
      userPrompt: 'Test prompt',
    },
    cells: [],
    selectedCellIds: [],
    compareMode: 'diff',
    sort: 'mean',
    group: 'model',
    gridCols: 3,
    viewMode: 'list',
    ...overrides,
  };
}

function seedStore(cellId: string, cellOverrides: Partial<CellResult> = {}): void {
  const cell = buildDoneCell(cellId, cellOverrides);
  const run = buildRun({ cells: [cell] });

  usePromptTesterStore.setState({
    runs: [run],
    activeRunId: 1,
    activeDetailCellId: cellId,
    editingRunId: null,
    analyzingCellIds: [],
    judgingCellId: null,
    streaming: { runId: null, cellIds: [] },
  });
}

// ---------------------------------------------------------------------------
// Smoke tests — DetailPanelContainer analysis pipeline wiring (T015, TDD Red)
// ---------------------------------------------------------------------------

describe('DetailPanelContainer — analysis pipeline wiring', () => {
  beforeEach(() => {
    seedStore('cell-1');
  });

  it('should render tier-2 metric sections when cell.tier2 is populated', async () => {
    // Arrange: seed cell with tier2 data
    seedStore('cell-1', { tier2: TIER2_DTO });

    await act(async () => {
      render(<DetailPanelContainer />);
    });

    // Assert: analysis-perplexity and analysis-further-measurements are present
    expect(screen.getByTestId('analysis-perplexity')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-further-measurements')).toBeInTheDocument();
  });

  it('should call analyzeCell with the active cell id when the Analyze button is clicked', async () => {
    // Arrange: no tier2 so Analyze button is visible; spy on store action
    const user = userEvent.setup();
    const spy = vi.spyOn(usePromptTesterStore.getState(), 'analyzeCell').mockResolvedValue();

    await act(async () => {
      render(<DetailPanelContainer />);
    });

    // Act: click the Analyze button (aria-label "Analyze" from DEFAULT_DETAIL_LABELS)
    const analyzeButton = screen.getByRole('button', { name: /^analyze$/i });
    await user.click(analyzeButton);

    // Assert: store action called with the open cell id
    expect(spy).toHaveBeenCalledWith('cell-1');
    spy.mockRestore();
  });

  it('should pass isAnalyzing=true to DetailPanel when analyzingCellIds includes the open cell', async () => {
    // Arrange: add cell-1 to analyzingCellIds to simulate in-progress analysis
    usePromptTesterStore.setState({ analyzingCellIds: ['cell-1'] });

    await act(async () => {
      render(<DetailPanelContainer />);
    });

    // Assert: the Analyze button is disabled (DetailPanel disables it when isAnalyzing=true)
    const analyzeButton = screen.getByRole('button', { name: /^analyze$/i });
    expect(analyzeButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// F-01 regression: perplexity display with flag ON
// ---------------------------------------------------------------------------

describe('DetailPanelContainer — F-01 regression: perplexity display when flag is ON', () => {
  beforeEach(() => {
    seedStore('cell-1');
  });

  it('should auto-display perplexity with no consent affordance when flag is ON and tier2.perplexity is set', async () => {
    seedStore('cell-1', { tier2: TIER2_DTO });

    await act(async () => {
      render(<DetailPanelContainer />);
    });

    expect(screen.getByTestId('analysis-perplexity')).toBeInTheDocument();
    expect(screen.queryByTestId('perplexity-consent')).not.toBeInTheDocument();
  });
});
