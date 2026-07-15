// TDD Red phase — archiveAndCreateEmptyTab does not exist yet. ALL tests must fail.

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports (Vitest hoisting)
// ---------------------------------------------------------------------------

import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCapturePrompt = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/prompts', () => ({
  capturePrompt: (...args: unknown[]) => mockCapturePrompt(...args),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

const mockArchiveRun = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/archivedRuns', () => ({
  archiveRun: (...args: unknown[]) => mockArchiveRun(...args),
  getAllArchivedRuns: vi.fn().mockResolvedValue([]),
}));

const mockGetLabRunById = vi.fn();
vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  getLabRunById: (...args: unknown[]) => mockGetLabRunById(...args),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

const mockLoadEntries = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/prompt-history', () => ({
  usePromptHistoryStore: {
    getState: () => ({ loadEntries: mockLoadEntries }),
  },
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn().mockImplementation(async function* () {
    yield 'ok';
  }),
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// Deferred imports (after vi.mock hoisting)
// ---------------------------------------------------------------------------

import type { LabRunRow } from '@/db/labRuns';

import type { LabState, ModelEntry, PromptEntry } from '../../types';
import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildModel = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  id: 'model-1',
  providerId: 'openrouter',
  modelKey: 'gpt-4',
  name: 'GPT-4',
  params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
  thinking: false,
  supportsThinking: false,
  expanded: true,
  accent: true,
  ...overrides,
});

const buildPrompt = (overrides: Partial<PromptEntry> = {}): PromptEntry => ({
  id: 'prompt-1',
  kind: 'custom',
  text: 'System instruction',
  edited: true,
  ...overrides,
});

const buildLabRunRow = (overrides: Partial<LabRunRow> = {}): LabRunRow => ({
  id: '1',
  label: 'Futtatás 1',
  createdAt: 1000000,
  updatedAt: 1000001,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getStore = (): LabState => usePromptTesterStore.getState() as LabState;

type StoreWithArchive = LabState & { archiveAndCreateEmptyTab: () => Promise<void> };

const getStoreWithAction = (): StoreWithArchive =>
  usePromptTesterStore.getState() as StoreWithArchive;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('archiveAndCreateEmptyTab', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(
      usePromptTesterStore.getInitialState
        ? usePromptTesterStore.getInitialState()
        : (usePromptTesterStore.getState() as LabState)
    );
    mockCapturePrompt.mockClear();
    mockArchiveRun.mockClear();
    mockGetLabRunById.mockClear();
    mockLoadEntries.mockClear();
    mockGetLabRunById.mockResolvedValue(buildLabRunRow());
  });

  it('should call capturePrompt with type USER for a non-empty user prompt', async () => {
    // Given the active tab has a non-empty user prompt
    usePromptTesterStore.setState({
      userPrompt: 'What is TDD?',
      prompts: [],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then capturePrompt is called with USER type
    expect(mockCapturePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'What is TDD?', type: 'USER', source: 'LAB' })
    );
  });

  it('should call capturePrompt with type SYSTEM for each non-empty composed system prompt', async () => {
    // Given the active tab has two non-empty system prompts (one custom, one edited skill)
    usePromptTesterStore.setState({
      userPrompt: 'prompt',
      prompts: [
        buildPrompt({ id: 'p1', kind: 'custom', text: 'Be concise', edited: true }),
        buildPrompt({ id: 'p2', kind: 'skill', text: 'Use examples', edited: true }),
      ],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then capturePrompt is called with SYSTEM type for each composed prompt
    expect(mockCapturePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Be concise', type: 'SYSTEM', source: 'LAB' })
    );
    expect(mockCapturePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Use examples', type: 'SYSTEM', source: 'LAB' })
    );
  });

  it('should NOT capture skill prompts that are not edited', async () => {
    // Given the active tab has an unedited skill prompt
    usePromptTesterStore.setState({
      userPrompt: 'prompt',
      prompts: [
        buildPrompt({ id: 'p1', kind: 'skill', text: 'Original skill text', edited: false }),
      ],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then capturePrompt is NOT called with SYSTEM type for the unedited skill
    expect(mockCapturePrompt).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SYSTEM' }));
  });

  it('should resolve LabRunRow from getLabRunById and pass it to archiveRun', async () => {
    // Given the active run id is 1 and getLabRunById returns a persisted LabRunRow
    const persistedRow = buildLabRunRow({
      id: '1',
      label: 'Persisted Run',
      cells: [],
    });
    mockGetLabRunById.mockResolvedValue(persistedRow);

    usePromptTesterStore.setState({
      userPrompt: '',
      prompts: [],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then getLabRunById was called with the string form of the ORIGINAL active run id (before createEmptyTab changed it)
    expect(mockGetLabRunById).toHaveBeenCalledWith('1');

    // And archiveRun received the persisted LabRunRow (not the in-memory RunTab)
    expect(mockArchiveRun).toHaveBeenCalledWith(persistedRow);
  });

  it('should create a new empty tab after archiving (activeRunId changes, new tab has empty config)', async () => {
    // Given the store has one tab with a model and a prompt
    usePromptTesterStore.setState({
      models: [buildModel()],
      prompts: [buildPrompt()],
      userPrompt: 'Some prompt',
    });
    const runsBefore = getStore().runs.length;
    const activeRunIdBefore = getStore().activeRunId;

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then a new tab exists
    const finalState = getStore();
    expect(finalState.runs.length).toBe(runsBefore + 1);

    // And the active tab changed
    expect(finalState.activeRunId).not.toBe(activeRunIdBefore);

    // And the new active tab has an empty configSnapshot
    const newActiveRun = finalState.runs.find(r => r.id === finalState.activeRunId);
    expect(newActiveRun?.configSnapshot.models).toHaveLength(0);
    expect(newActiveRun?.configSnapshot.prompts).toHaveLength(0);
    expect(newActiveRun?.configSnapshot.userPrompt).toBe('');
    expect(newActiveRun?.cells).toHaveLength(0);
  });

  it('should refresh prompt history store via loadEntries after archiving', async () => {
    // Given a normal active tab state
    usePromptTesterStore.setState({
      userPrompt: '',
      prompts: [],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then usePromptHistoryStore.getState().loadEntries was called
    expect(mockLoadEntries).toHaveBeenCalledTimes(1);
  });

  it('should skip user prompt capture when userPrompt is empty', async () => {
    // Given the active tab has an empty user prompt
    usePromptTesterStore.setState({
      userPrompt: '',
      prompts: [],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then capturePrompt is NOT called with USER type
    expect(mockCapturePrompt).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'USER' }));
  });

  it('should skip user prompt capture when userPrompt is whitespace-only', async () => {
    // Given the active tab has a whitespace-only user prompt
    usePromptTesterStore.setState({
      userPrompt: '   ',
      prompts: [],
    });

    // When archiveAndCreateEmptyTab is called
    await act(async () => {
      await getStoreWithAction().archiveAndCreateEmptyTab();
    });

    // Then capturePrompt is NOT called with USER type
    expect(mockCapturePrompt).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'USER' }));
  });
});
