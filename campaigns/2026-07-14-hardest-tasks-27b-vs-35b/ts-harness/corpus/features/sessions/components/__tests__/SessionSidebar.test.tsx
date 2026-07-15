import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionSidebar, type SessionSidebarProps } from '../SessionSidebar';

// -- Builders --

const buildProps = (overrides?: Partial<SessionSidebarProps>): SessionSidebarProps => ({
  sessions: [],
  activeSessionId: null,
  canCreateSession: true,
  onNewChat: vi.fn(),
  onSelectSession: vi.fn(),
  onDeleteSession: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionSidebar', () => {
  it('should match snapshot', () => {
    const { asFragment } = render(<SessionSidebar {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  // FR-031: new-chat button rounding must match Prompt-Lab button (rounded-lg)
  it('should render the new-chat button with rounded-lg class for consistent rounding system', () => {
    const { container } = render(<SessionSidebar {...buildProps()} />);

    const newChatButton = container.querySelector('[data-testid="new-chat-button"]');

    expect(newChatButton).not.toBeNull();
    expect(newChatButton?.className).toContain('rounded-lg');
  });

  it('should call onNewChat when the new-chat button is clicked', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onNewChat = vi.fn();
    const { getByTestId } = render(<SessionSidebar {...buildProps({ onNewChat })} />);

    await user.click(getByTestId('new-chat-button'));

    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it('should disable the new-chat button when canCreateSession is false', () => {
    const { container } = render(<SessionSidebar {...buildProps({ canCreateSession: false })} />);

    const newChatButton = container.querySelector('[data-testid="new-chat-button"]');

    expect(newChatButton).toBeDisabled();
  });
});
