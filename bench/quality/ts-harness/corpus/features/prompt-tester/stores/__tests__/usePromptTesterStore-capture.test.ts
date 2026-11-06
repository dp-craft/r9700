import { beforeEach, describe, expect, it, vi } from 'vitest';

// Boundary mocks — must be declared before imports (Vitest hoisting)

const mockCapturePrompt = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/prompts', () => ({
  capturePrompt: (...args: unknown[]) => mockCapturePrompt(...args),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn().mockImplementation(async function* () {
    yield 'ok';
  }),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

import type { ModelEntry, PromptEntry } from '../../types';
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
  text: 'Default system prompt',
  edited: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — capturePrompt on run', () => {
  beforeEach(() => {
    usePromptTesterStore.setState({
      models: [],
      prompts: [],
      userPrompt: '',
    });
    mockCapturePrompt.mockClear();
  });

  it('should call capturePrompt with USER/LAB for user prompt on runFull', async () => {
    // Arrange
    usePromptTesterStore.setState({
      models: [buildModel()],
      prompts: [buildPrompt()],
      userPrompt: 'Test it',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(mockCapturePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Test it', type: 'USER', source: 'LAB' })
    );
  });

  it('should call capturePrompt with SYSTEM/LAB for edited skill prompt', async () => {
    // Arrange
    usePromptTesterStore.setState({
      models: [buildModel()],
      prompts: [buildPrompt({ kind: 'skill', edited: true, text: 'Be concise' })],
      userPrompt: 'Run it',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(mockCapturePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Be concise', type: 'SYSTEM', source: 'LAB' })
    );
  });

  it('should NOT call capturePrompt for unedited skill prompt', async () => {
    // Arrange
    usePromptTesterStore.setState({
      models: [buildModel()],
      prompts: [buildPrompt({ kind: 'skill', edited: false, text: 'Original' })],
      userPrompt: 'Run it',
    });

    // Act
    await usePromptTesterStore.getState().runFull();

    // Assert
    expect(mockCapturePrompt).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SYSTEM' }));
  });
});
