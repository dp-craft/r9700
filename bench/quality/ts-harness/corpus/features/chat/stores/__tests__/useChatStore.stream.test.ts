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

import { streamRegistry } from '@/services/streaming/streamRegistry';

import { useChatStore } from '../useChatStore';

const STREAM_ID = 'stream-abc';
const STREAM_LABEL = 'Test stream';

const mockRegistry = streamRegistry as unknown as {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
};

describe('useChatStore — streaming lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState(useChatStore.getInitialState?.() ?? {});
  });

  // ---------------------------------------------------------------------------
  // startStream
  // ---------------------------------------------------------------------------

  describe('startStream(id, label)', () => {
    it('should set isStreaming to true when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);

      expect(useChatStore.getState().isStreaming).toBe(true);
    });

    it('should reset streamingContent to empty string when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);

      expect(useChatStore.getState().streamingContent).toBe('');
    });

    it('should clear error to null when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);

      expect(useChatStore.getState().error).toBeNull();
    });

    it('should call streamRegistry.register with origin chat when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);

      expect(mockRegistry.register).toHaveBeenCalledOnce();
      expect(mockRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: STREAM_ID, label: STREAM_LABEL, origin: 'chat' })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // appendStreamContent
  // ---------------------------------------------------------------------------

  describe('appendStreamContent(chunk)', () => {
    it('should append chunk to streamingContent when called once', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamContent('Hello');

      expect(useChatStore.getState().streamingContent).toBe('Hello');
    });

    it('should concatenate successive chunks when called multiple times', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamContent('Hello');
      useChatStore.getState().appendStreamContent(' world');

      expect(useChatStore.getState().streamingContent).toBe('Hello world');
    });
  });

  // ---------------------------------------------------------------------------
  // completeStream
  // ---------------------------------------------------------------------------

  describe('completeStream()', () => {
    it('should set isStreaming to false when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().completeStream();

      expect(useChatStore.getState().isStreaming).toBe(false);
    });

    it('should clear streamingContent to empty string when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().appendStreamContent('partial');
      useChatStore.getState().completeStream();

      expect(useChatStore.getState().streamingContent).toBe('');
    });

    it('should call streamRegistry.unregister with the stream id when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().completeStream();

      expect(mockRegistry.unregister).toHaveBeenCalledOnce();
      expect(mockRegistry.unregister).toHaveBeenCalledWith(STREAM_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // abortStream
  // ---------------------------------------------------------------------------

  describe('abortStream()', () => {
    it('should call abort on the internal AbortController when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      const signal = useChatStore.getState().getAbortSignal();

      useChatStore.getState().abortStream();

      expect(signal?.aborted).toBe(true);
    });

    it('should set isStreaming to false when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().abortStream();

      expect(useChatStore.getState().isStreaming).toBe(false);
    });

    it('should call streamRegistry.unregister with the stream id when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().abortStream();

      expect(mockRegistry.unregister).toHaveBeenCalledOnce();
      expect(mockRegistry.unregister).toHaveBeenCalledWith(STREAM_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // setStreamError
  // ---------------------------------------------------------------------------

  describe('setStreamError(msg)', () => {
    it('should set error to the message when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().setStreamError('Network timeout');

      expect(useChatStore.getState().error).toBe('Network timeout');
    });

    it('should set isStreaming to false when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().setStreamError('Network timeout');

      expect(useChatStore.getState().isStreaming).toBe(false);
    });

    it('should call streamRegistry.unregister with the stream id when called', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().setStreamError('Network timeout');

      expect(mockRegistry.unregister).toHaveBeenCalledOnce();
      expect(mockRegistry.unregister).toHaveBeenCalledWith(STREAM_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // clearStreamError
  // ---------------------------------------------------------------------------

  describe('clearStreamError()', () => {
    it('should set error to null when called after an error was set', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      useChatStore.getState().setStreamError('boom');
      useChatStore.getState().clearStreamError();

      expect(useChatStore.getState().error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getAbortSignal
  // ---------------------------------------------------------------------------

  describe('getAbortSignal()', () => {
    it('should return null when no stream is active', () => {
      expect(useChatStore.getState().getAbortSignal()).toBeNull();
    });

    it('should return an AbortSignal when a stream is active', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      const signal = useChatStore.getState().getAbortSignal();

      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('should return a non-aborted signal immediately after startStream', () => {
      useChatStore.getState().startStream(STREAM_ID, STREAM_LABEL);
      const signal = useChatStore.getState().getAbortSignal();

      expect(signal?.aborted).toBe(false);
    });
  });
});
