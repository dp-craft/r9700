import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
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

import type { TestInLabPayload } from '@/domain/cross-mf';

import { usePromptTesterStore } from '../usePromptTesterStore';

const buildPayload = (overrides?: Partial<TestInLabPayload>): TestInLabPayload => ({
  source: 'chat-deep-link',
  userPrompt: 'Explain TDD',
  systemPrompts: [],
  model: 'gpt-4o',
  providerId: 'openai',
  sourceSessionId: 'session-abc',
  ...overrides,
});

beforeEach(() => {
  usePromptTesterStore.setState({
    userPrompt: '',
    prompts: [],
    models: [],
  });
});

describe('usePromptTesterStore — openScratchTab', () => {
  it('should set userPrompt from payload when openScratchTab fires', () => {
    // Given a payload with userPrompt 'foo'
    const payload = buildPayload({ userPrompt: 'foo' });

    // When openScratchTab fires
    usePromptTesterStore.getState().openScratchTab(payload);

    // Then state.userPrompt equals 'foo'
    expect(usePromptTesterStore.getState().userPrompt).toBe('foo');
  });

  it('should append a model entry for the payload model when it does not already exist', () => {
    // Given a payload with model 'gpt-4o' and no prior models in state
    const payload = buildPayload({ model: 'gpt-4o' });

    // When openScratchTab fires
    usePromptTesterStore.getState().openScratchTab(payload);

    // Then models array contains an entry with modelKey matching the payload model
    const { models } = usePromptTesterStore.getState();
    expect(models.some(m => m.modelKey === 'gpt-4o')).toBe(true);
  });

  it('should map systemPrompts array to prompts entries when systemPrompts are provided', () => {
    // Given a payload with two system prompts
    const payload = buildPayload({ systemPrompts: ['You are helpful.', 'Be concise.'] });

    // When openScratchTab fires
    usePromptTesterStore.getState().openScratchTab(payload);

    // Then prompts has two entries with the corresponding text values
    const { prompts } = usePromptTesterStore.getState();
    expect(prompts).toHaveLength(2);
    expect(prompts[0].text).toBe('You are helpful.');
    expect(prompts[1].text).toBe('Be concise.');
  });

  it('should set providerId on the new model entry from the payload providerId', () => {
    // Given a payload with a known non-empty providerId and a model not already present
    const payload = buildPayload({ model: 'claude-3-5-sonnet', providerId: 'anthropic' });

    // When openScratchTab fires
    usePromptTesterStore.getState().openScratchTab(payload);

    // Then the appended model entry carries the payload's providerId (not '')
    const entry = usePromptTesterStore
      .getState()
      .models.find(m => m.modelKey === 'claude-3-5-sonnet');
    expect(entry?.providerId).toBe('anthropic');
  });

  it('should not duplicate a model entry when the model already exists in state', () => {
    // Given state already contains gpt-4o

    (usePromptTesterStore.setState as (updater: (s: any) => Partial<any>) => void)(_s => ({
      models: [
        {
          id: 'existing-id',
          providerId: 'openrouter',
          modelKey: 'gpt-4o',
          name: 'GPT-4o',
          params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
          thinking: false,
          supportsThinking: false,
          expanded: false,
          accent: true,
        },
      ],
    }));
    const payload = buildPayload({ model: 'gpt-4o' });

    // When openScratchTab fires
    usePromptTesterStore.getState().openScratchTab(payload);

    // Then still only one model entry (no duplicate added)
    expect(usePromptTesterStore.getState().models).toHaveLength(1);
  });
});
