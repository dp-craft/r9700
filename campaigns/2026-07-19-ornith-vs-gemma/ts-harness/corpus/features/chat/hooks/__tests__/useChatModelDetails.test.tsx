import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession, ModelParamsDTO } from '@/domain/entities';
import { useSessionStore } from '@/features/sessions';
import { DEFAULT_MODEL_PARAMS } from '@/lib/model-params';
import type { Model } from '@/services/llm/types';

// -- Boundary mocks --

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/features/settings', () => ({
  buildModelMetadataRows: () => [],
}));

// -- Import under test (after all mocks) --

import { useChatModelDetails } from '../useChatModelDetails';

// -- Builders --

const FIXED_TS = 1_700_000_000_000;

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Test',
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  model: 'model-a',
  providerId: 'openrouter',
  skillSnapshot: null,
  ...overrides,
});

const buildParams = (overrides?: Partial<ModelParamsDTO>): ModelParamsDTO => ({
  ...DEFAULT_MODEL_PARAMS,
  thinkingEnabled: false,
  ...overrides,
});

const buildModel = (overrides?: Partial<Model>): Model =>
  ({
    id: 'model-a',
    name: 'Model A',
    supportsThinking: true,
    ...overrides,
  }) as Model;

// -- Tests --

describe('useChatModelDetails — thinking toggle', () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ modelParams: buildParams({ thinkingEnabled: false }) })],
      setSessionModelParams: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('calls setSessionModelParams with thinkingEnabled flipped to true', () => {
    const { result } = renderHook(() => useChatModelDetails(buildModel()));
    const setSessionModelParams = useSessionStore.getState().setSessionModelParams as ReturnType<
      typeof vi.fn
    >;

    act(() => {
      result.current.onThinkingToggle();
    });

    expect(setSessionModelParams).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ thinkingEnabled: true })
    );
  });

  it('calls setSessionModelParams with thinkingEnabled flipped to false when currently true', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ modelParams: buildParams({ thinkingEnabled: true }) })],
      setSessionModelParams: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useChatModelDetails(buildModel()));
    const setSessionModelParams = useSessionStore.getState().setSessionModelParams as ReturnType<
      typeof vi.fn
    >;

    act(() => {
      result.current.onThinkingToggle();
    });

    expect(setSessionModelParams).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ thinkingEnabled: false })
    );
  });

  it('does not call setSessionModelParams when there is no active session', () => {
    useSessionStore.setState({
      activeSessionId: null,
      sessionList: [],
      setSessionModelParams: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useChatModelDetails(buildModel()));
    const setSessionModelParams = useSessionStore.getState().setSessionModelParams as ReturnType<
      typeof vi.fn
    >;

    act(() => {
      result.current.onThinkingToggle();
    });

    expect(setSessionModelParams).not.toHaveBeenCalled();
  });

  it('returns supportsThinking false when model has supportsThinking undefined', () => {
    const { result } = renderHook(() =>
      useChatModelDetails(buildModel({ supportsThinking: undefined }))
    );
    expect(result.current.supportsThinking).toBe(false);
  });

  it('returns supportsThinking true when model.supportsThinking is true', () => {
    const { result } = renderHook(() =>
      useChatModelDetails(buildModel({ supportsThinking: true }))
    );
    expect(result.current.supportsThinking).toBe(true);
  });
});
