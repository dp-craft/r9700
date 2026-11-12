import { render } from '@testing-library/react';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageViewModel } from '../types';
import type { MessageListProps } from './MessageList';
import { MessageList } from './MessageList';

// -- Mocks --

vi.mock('./MessageBubble', () => ({
  MessageBubble: (props: { readonly message: { readonly id: string } }) => (
    <div data-testid={`msg-${props.message.id}`} />
  ),
}));

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    readonly children: React.ReactNode;
    readonly className?: string;
  }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
}));

// -- Builders --

const buildMessage = (overrides?: Partial<MessageViewModel>): MessageViewModel => ({
  id: 'msg-1',
  sessionId: 'session-1',
  role: 'user',
  content: 'Hello world',
  createdAt: 1000,
  ...overrides,
});

const buildProps = (overrides?: Partial<MessageListProps>): MessageListProps => ({
  messages: [buildMessage()],
  isStreaming: false,
  streamingContent: '',
  bottomRef: React.createRef<HTMLDivElement | null>(),
  onCopyMessage: vi.fn(),
  ...overrides,
});

// -- Helpers --

const getMessageContainer = (container: HTMLElement): Element | null =>
  container.querySelector('[data-testid="scroll-area"] > div');

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageList', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<MessageList {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render all provided messages', () => {
    const messages = [
      buildMessage({ id: 'msg-1' }),
      buildMessage({ id: 'msg-2', content: 'Second message' }),
    ];

    const { getByTestId } = render(<MessageList {...buildProps({ messages })} />);

    expect(getByTestId('msg-msg-1')).toBeInTheDocument();
    expect(getByTestId('msg-msg-2')).toBeInTheDocument();
  });

  it('should render streaming message when isStreaming is true', () => {
    const { getByTestId } = render(
      <MessageList
        {...buildProps({
          isStreaming: true,
          streamingContent: 'Streaming...',
        })}
      />
    );

    expect(getByTestId('msg-streaming')).toBeInTheDocument();
  });

  it('should not render streaming message when isStreaming is false', () => {
    const { queryByTestId } = render(<MessageList {...buildProps({ isStreaming: false })} />);

    expect(queryByTestId('msg-streaming')).not.toBeInTheDocument();
  });

  // -- fontSizeClass prop tests --

  describe('fontSizeClass prop', () => {
    it('should render the message container without fontSizeClass when prop is not provided', () => {
      const { container } = render(<MessageList {...buildProps()} />);

      const messageContainer = getMessageContainer(container);

      expect(messageContainer).not.toBeNull();
      expect(messageContainer?.className).toContain('flex');
      expect(messageContainer?.className).toContain('flex-col');
      expect(messageContainer?.className).toContain('gap-4');
    });

    it('should NOT apply fontSizeClass to the container div (font scaling is global)', () => {
      const { container } = render(
        <MessageList {...buildProps({ fontSizeClass: 'text-sm' } as Partial<MessageListProps>)} />
      );

      const messageContainer = getMessageContainer(container);

      expect(messageContainer).not.toBeNull();
      expect(messageContainer?.className).toContain('flex');
      expect(messageContainer?.className).toContain('flex-col');
      expect(messageContainer?.className).toContain('gap-4');
      expect(messageContainer?.className).not.toContain('text-sm');
    });
  });

  // -- Edge cases --

  it('should render with an empty messages array', () => {
    const { queryByTestId } = render(<MessageList {...buildProps({ messages: [] })} />);

    expect(queryByTestId('msg-msg-1')).not.toBeInTheDocument();
  });

  it('should render the bottom ref div for scroll anchoring', () => {
    const { container } = render(<MessageList {...buildProps()} />);

    const bottomDiv = container.querySelector('[aria-hidden="true"]');

    expect(bottomDiv).toBeInTheDocument();
  });
});
