import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatSession, ModelParamsDTO } from '@/domain/entities';
import { useSessionStore } from '@/features/sessions';
import { DEFAULT_MODEL_PARAMS } from '@/lib/model-params';

// -- Boundary mocks --

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// -- Capture props from ModelParamsPopover renderer --

let capturedProps: Record<string, unknown> = {};

vi.mock('../../components/ModelParamsPopover', () => ({
  ModelParamsPopover: (props: Record<string, unknown>) => {
    capturedProps = props;
    return <div data-testid="model-params-popover" />;
  },
}));

// -- Import under test (after all mocks) --

import { ModelParamsPopoverContainer } from '../ModelParamsPopoverContainer';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  model: 'llama3',
  providerId: 'ollama',
  skillSnapshot: null,
  ...overrides,
});

// -- Store snapshot for reset --

const initialSessionState = useSessionStore.getState();

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  capturedProps = {};
  useSessionStore.setState(initialSessionState, true);
});

// -- Tests --

describe('ModelParamsPopoverContainer — thinking persistence', () => {
  it('should call setSessionModelParams with thinkingEnabled true when toggled on', () => {
    const mockSetParams = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ modelParams: undefined })],
      setSessionModelParams: mockSetParams,
    });

    render(<ModelParamsPopoverContainer supportsThinking />);

    const handler = capturedProps.onThinkingEnabledChange as (enabled: boolean) => void;
    handler(true);

    expect(mockSetParams).toHaveBeenCalledOnce();
    const [sessionId, params] = mockSetParams.mock.calls[0] as [string, ModelParamsDTO];
    expect(sessionId).toBe('session-1');
    expect(params.thinkingEnabled).toBe(true);
  });

  it('should call setSessionModelParams with thinkingEnabled false when toggled off', () => {
    const mockSetParams = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [
        buildSession({ modelParams: { ...DEFAULT_MODEL_PARAMS, thinkingEnabled: true } }),
      ],
      setSessionModelParams: mockSetParams,
    });

    render(<ModelParamsPopoverContainer supportsThinking />);

    const handler = capturedProps.onThinkingEnabledChange as (enabled: boolean) => void;
    handler(false);

    expect(mockSetParams).toHaveBeenCalledOnce();
    const [sessionId, params] = mockSetParams.mock.calls[0] as [string, ModelParamsDTO];
    expect(sessionId).toBe('session-1');
    expect(params.thinkingEnabled).toBe(false);
  });

  it('should not call setSessionModelParams when no active session', () => {
    const mockSetParams = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: null,
      sessionList: [],
      setSessionModelParams: mockSetParams,
    });

    render(<ModelParamsPopoverContainer supportsThinking />);

    // Container returns null when no sessionId — no popover rendered
    expect(capturedProps).toEqual({});
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it('should pass supportsThinking prop through to ModelParamsPopover', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      setSessionModelParams: vi.fn().mockResolvedValue(undefined),
    });

    render(<ModelParamsPopoverContainer supportsThinking={false} />);

    expect(capturedProps.supportsThinking).toBe(false);
  });

  it('should preserve existing model params when updating thinkingEnabled', () => {
    const mockSetParams = vi.fn().mockResolvedValue(undefined);
    const existingParams: ModelParamsDTO = {
      ...DEFAULT_MODEL_PARAMS,
      temperature: 1.2,
      maxTokens: 4096,
      thinkingEnabled: false,
    };

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ modelParams: existingParams })],
      setSessionModelParams: mockSetParams,
    });

    render(<ModelParamsPopoverContainer supportsThinking />);

    const handler = capturedProps.onThinkingEnabledChange as (enabled: boolean) => void;
    handler(true);

    const [, params] = mockSetParams.mock.calls[0] as [string, ModelParamsDTO];
    expect(params.temperature).toBe(1.2);
    expect(params.maxTokens).toBe(4096);
    expect(params.thinkingEnabled).toBe(true);
  });
});
