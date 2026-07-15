// TDD Red phase — asserts that useModelGroups populates modelKey with the BARE
// model id (e.g. 'deepseek-r1:latest') separately from the composite id
// ('ollama::deepseek-r1:latest'). Tests fail until the source fix is applied.

// ---------------------------------------------------------------------------
// Boundary mocks — hoisted before imports
// ---------------------------------------------------------------------------

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/settings', () => ({
  useSettingsStore: vi.fn(
    (selector: (s: { providerConfigs: Record<string, unknown> }) => unknown) =>
      selector({ providerConfigs: {} })
  ),
  useFeatureFlagStore: vi.fn((selector: (s: { flags: Record<string, boolean> }) => unknown) =>
    selector({ flags: { 'show-cors-providers': false } })
  ),
}));

vi.mock('@/services/llm/provider-meta', () => ({
  getVisibleProviderOrder: vi.fn(() => ['ollama']),
  PROVIDER_META: {
    ollama: { name: 'Ollama', defaultBaseUrl: 'http://localhost:11434' },
  },
}));

const mockListModels = vi
  .fn()
  .mockResolvedValue([{ id: 'deepseek-r1:latest', name: 'DeepSeek R1' }]);

vi.mock('@/services/llm/registry', () => ({
  lookupProvider: vi.fn(() => ({
    listModels: mockListModels,
  })),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { useModelGroups } from '../useModelGroups';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useModelGroups — modelKey regression (bare id vs composite id)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListModels.mockResolvedValue([{ id: 'deepseek-r1:latest', name: 'DeepSeek R1' }]);
  });

  it('should set id to the composite provider::model key for React key uniqueness', async () => {
    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    expect(option.id).toBe('ollama::deepseek-r1:latest');
  });

  it('should set modelKey to the BARE model id (regression: was composite pre-fix)', async () => {
    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    // THE regression assertion — modelKey must be the bare id, not the composite
    expect(option.modelKey).toBe('deepseek-r1:latest');
  });

  it('should set providerId to the provider id string', async () => {
    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    expect(option.providerId).toBe('ollama');
  });
});

describe('useModelGroups — supportsThinking passthrough (T011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set supportsThinking to true when model reports supportsThinking true', async () => {
    mockListModels.mockResolvedValue([
      { id: 'thinking-model', name: 'Thinking Model', supportsThinking: true },
    ]);

    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    expect(option.supportsThinking).toBe(true);
  });

  it('should set supportsThinking to false when model reports supportsThinking false', async () => {
    mockListModels.mockResolvedValue([
      { id: 'basic-model', name: 'Basic Model', supportsThinking: false },
    ]);

    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    expect(option.supportsThinking).toBe(false);
  });

  it('should default supportsThinking to false when model omits the field (fail-closed)', async () => {
    mockListModels.mockResolvedValue([{ id: 'legacy-model', name: 'Legacy Model' }]);

    const { result } = renderHook(() => useModelGroups());

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const option = result.current[0].models[0];
    expect(option.supportsThinking).toBe(false);
  });
});
