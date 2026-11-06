import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageViewModel } from '../../types';
import { MessageList, type MessageListProps } from '../MessageList';

// -- Builders --

function buildMessage(overrides?: Partial<MessageViewModel>): MessageViewModel {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: 'Hello',
    createdAt: 1000,
    ...overrides,
  };
}

function buildProps(overrides?: Partial<MessageListProps>): MessageListProps {
  return {
    messages: [buildMessage()],
    isStreaming: false,
    streamingContent: '',
    bottomRef: { current: null },
    onCopyMessage: vi.fn(),
    ...overrides,
  };
}

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageList — testInLab prop threading', () => {
  it('should forward showTestInLab=true to each MessageBubble', () => {
    const messages = [
      buildMessage({ id: 'msg-1', content: 'First' }),
      buildMessage({ id: 'msg-2', content: 'Second' }),
    ];
    render(
      <MessageList
        {...buildProps({
          messages,
          showTestInLab: true,
          onTestInLab: vi.fn(),
          testInLabLabel: 'Test in Lab',
        })}
      />
    );

    const buttons = screen.getAllByRole('button', { name: 'Test in Lab' });
    expect(buttons).toHaveLength(2);
  });

  it('should not render test-in-lab buttons when showTestInLab=false', () => {
    const messages = [
      buildMessage({ id: 'msg-1', content: 'First' }),
      buildMessage({ id: 'msg-2', content: 'Second' }),
    ];
    render(
      <MessageList
        {...buildProps({
          messages,
          showTestInLab: false,
          onTestInLab: vi.fn(),
          testInLabLabel: 'Test in Lab',
        })}
      />
    );

    expect(screen.queryByRole('button', { name: 'Test in Lab' })).toBeNull();
  });

  it('should forward testInLabLabel to each MessageBubble', () => {
    const messages = [
      buildMessage({ id: 'msg-1', content: 'Alpha' }),
      buildMessage({ id: 'msg-2', content: 'Beta' }),
    ];
    render(
      <MessageList
        {...buildProps({
          messages,
          showTestInLab: true,
          onTestInLab: vi.fn(),
          testInLabLabel: 'Send to Lab',
        })}
      />
    );

    const buttons = screen.getAllByRole('button', { name: 'Send to Lab' });
    expect(buttons).toHaveLength(2);
  });

  it('should call onTestInLab with the correct message when the button is clicked', async () => {
    const user = userEvent.setup();
    const onTestInLab = vi.fn();
    const targetMessage = buildMessage({ id: 'msg-42', content: 'Target message' });
    render(
      <MessageList
        {...buildProps({
          messages: [targetMessage],
          showTestInLab: true,
          onTestInLab,
          testInLabLabel: 'Test in Lab',
        })}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Test in Lab' }));

    expect(onTestInLab).toHaveBeenCalledOnce();
    expect(onTestInLab).toHaveBeenCalledWith(targetMessage);
  });
});
