// Boundary mocks — declared before imports per Vitest hoisting rules
vi.mock('@/services/streaming/streamRegistry', () => ({
  streamRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    list: vi.fn(() => []),
    abort: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock('@/services/llm/registry', () => ({
  lookupProvider: vi.fn(),
}));

vi.mock('@/config', () => ({
  loadConfig: vi.fn(),
  MAX_CONTEXT_MESSAGES: 50,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../useChatStore';

const STREAM_ID = 'stream-reasoning';
const STREAM_LABEL = 'Reasoning stream';

describe('useChatStore — streamingReasoning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState(useChatStore.getInitialState?.() ?? {});
  });

  // ---------------------------------------------------------------------------
  // appendStreamReasoning
  // ---------------------------------------------------------------------------

  describe('appendStreamReasoning(chunk)', () => {
    it('should append reasoning chunk to streamingReasoning when called once', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamReasoning('Thinking about');

      expect(useChatStore.getState().streamingReasoning).toBe('Thinking about');
    });

    it('should concatenate successive reasoning chunks when called multiple times', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamReasoning('Step 1. ');
      useChatStore.getState().appendStreamReasoning('Step 2.');

      expect(useChatStore.getState().streamingReasoning).toBe('Step 1. Step 2.');
    });
  });

  // ---------------------------------------------------------------------------
  // startStream resets streamingReasoning
  // ---------------------------------------------------------------------------

  describe('startStream — reasoning reset', () => {
    it('should reset streamingReasoning to empty string when starting a new stream', () => {
      // Arrange — simulate leftover reasoning from prior stream
      useChatStore.setState({ streamingReasoning: 'leftover reasoning' });

      // Act
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);

      // Assert
      expect(useChatStore.getState().streamingReasoning).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // completeStream resets streamingReasoning
  // ---------------------------------------------------------------------------

  describe('completeStream — reasoning reset', () => {
    it('should reset streamingReasoning to empty string when stream completes', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamReasoning('deep thought');
      useChatStore.getState().completeStream();

      expect(useChatStore.getState().streamingReasoning).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // abortStream resets streamingReasoning
  // ---------------------------------------------------------------------------

  describe('abortStream — reasoning reset', () => {
    it('should reset streamingReasoning to empty string when stream is aborted', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamReasoning('partial thought');
      useChatStore.getState().abortStream();

      expect(useChatStore.getState().streamingReasoning).toBe('');
    });
  });

  // ---------------------------------------------------------------------------
  // initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('should initialize streamingReasoning as empty string', () => {
      expect(useChatStore.getState().streamingReasoning).toBe('');
    });
  });
});
