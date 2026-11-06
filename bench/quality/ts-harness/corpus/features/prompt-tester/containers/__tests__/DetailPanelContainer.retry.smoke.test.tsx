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

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import type { CellResult, RunTab } from '../../types';
import { DetailPanelContainer } from '../DetailPanelContainer';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS = { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 };
const DEFAULT_RATINGS = { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 };

function buildErrorCell(id: string, modelId: string, promptId: string): CellResult {
  return {
    id,
    modelId,
    promptId,
    userPromptHash: 'hash-1',
    output: '',
    latencyMs: 0,
    tokens: 0,
    cost: 0,
    ratings: DEFAULT_RATINGS,
    cached: false,
    status: 'error',
    error: 'Provider 404',
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

function seedStore(cellId: string): void {
  const cell = buildErrorCell(cellId, 'model-1', 'prompt-1');
  const run = buildRun({ cells: [cell] });

  usePromptTesterStore.setState({
    runs: [run],
    activeRunId: 1,
    activeDetailCellId: cellId,
    editingRunId: null,
    streaming: { runId: null, cellIds: [] },
  });
}

// ---------------------------------------------------------------------------
// Smoke tests — DetailPanelContainer retry wiring (T004, TDD Red phase)
// ---------------------------------------------------------------------------

describe('DetailPanelContainer — retry wiring', () => {
  beforeEach(() => {
    seedStore('cell-err-1');
  });

  it('should wire onRetry to retryCell(activeDetailCellId) when the Retry button is clicked', async () => {
    // Given: store seeded with errored cell as activeDetailCellId
    const user = userEvent.setup();
    const spy = vi.spyOn(usePromptTesterStore.getState(), 'retryCell');

    await act(async () => {
      render(<DetailPanelContainer />);
    });

    // When: the user clicks the Retry button
    const retryButton = screen.getByRole('button', { name: /retry/i });
    await user.click(retryButton);

    // Then: retryCell is called with the active cell id
    expect(spy).toHaveBeenCalledWith('cell-err-1');
    spy.mockRestore();
  });
});
