import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionSidebarProps } from '../SessionSidebar';
import { SessionSidebar } from '../SessionSidebar';

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
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<SessionSidebar {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Mobile hamburger button --

  describe('Mobile hamburger button', () => {
    it('should render hamburger menu button', () => {
      render(<SessionSidebar {...buildProps()} />);

      expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
    });

    it('should use "Open sidebar" as default aria-label for hamburger button', () => {
      render(<SessionSidebar {...buildProps()} />);

      const button = screen.getByRole('button', { name: 'Open sidebar' });

      expect(button).toHaveAttribute('aria-label', 'Open sidebar');
    });

    it('should use custom openSidebarLabel when provided', () => {
      render(<SessionSidebar {...buildProps({ openSidebarLabel: 'Toggle nav' })} />);

      expect(screen.getByRole('button', { name: 'Toggle nav' })).toBeInTheDocument();
    });

    it('should render hamburger button inside mobile-only wrapper', () => {
      render(<SessionSidebar {...buildProps()} />);

      const hamburgerButton = screen.getByRole('button', { name: 'Open sidebar' });
      const mobileWrapper = hamburgerButton.closest('div.flex.md\\:hidden');

      expect(mobileWrapper).toBeInTheDocument();
    });
  });

  // -- Desktop sidebar --

  describe('Desktop sidebar', () => {
    it('should render desktop sidebar wrapper with md:flex class', () => {
      const { container } = render(<SessionSidebar {...buildProps()} />);

      const desktopSidebar = container.querySelector('.md\\:flex.hidden');

      expect(desktopSidebar).toBeInTheDocument();
    });

    it('should render new chat button inside desktop sidebar', () => {
      render(<SessionSidebar {...buildProps()} />);

      const newChatButtons = screen.getAllByRole('button', { name: 'New chat' });

      expect(newChatButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -- Mobile Sheet component --

  describe('Mobile Sheet component', () => {
    it('should render Sheet trigger wrapper in mobile container', () => {
      render(<SessionSidebar {...buildProps()} />);

      const mobileWrapper = document.querySelector('div.flex.md\\:hidden');

      expect(mobileWrapper).toBeInTheDocument();
    });

    it('should render hamburger button as the Sheet trigger', () => {
      render(<SessionSidebar {...buildProps()} />);

      const trigger = screen.getByRole('button', { name: 'Open sidebar' });

      expect(trigger).toBeInTheDocument();
    });
  });

  // -- Props passed to both views --

  describe('Content props forwarding', () => {
    // Note: JSDOM renders both desktop and mobile wrappers in the DOM,
    // but Sheet content is only rendered when opened (portal). So desktop
    // sidebar content appears once (the always-rendered desktop view).

    it('should render new chat button with default label in desktop view', () => {
      render(<SessionSidebar {...buildProps()} />);

      expect(screen.getByText('+ New Chat')).toBeInTheDocument();
    });

    it('should render custom newChatLabel in desktop view', () => {
      render(<SessionSidebar {...buildProps({ newChatLabel: 'Start Chat' })} />);

      expect(screen.getByText('Start Chat')).toBeInTheDocument();
    });

    it('should disable new chat button when canCreateSession is false', () => {
      render(<SessionSidebar {...buildProps({ canCreateSession: false })} />);

      const newChatButton = screen.getByRole('button', { name: 'New chat' });

      expect(newChatButton).toBeDisabled();
    });

    it('should render noChatsLabel when sessions list is empty', () => {
      render(<SessionSidebar {...buildProps({ noChatsLabel: 'Nothing here', sessions: [] })} />);

      expect(screen.getByText('Nothing here')).toBeInTheDocument();
    });

    it('should render header slot in desktop view', () => {
      const header = <div data-testid="test-header">My Header</div>;
      render(<SessionSidebar {...buildProps({ header })} />);

      expect(screen.getByTestId('test-header')).toBeInTheDocument();
    });

    it('should render footer slot in desktop view', () => {
      const footer = <div data-testid="test-footer">My Footer</div>;
      render(<SessionSidebar {...buildProps({ footer })} />);

      expect(screen.getByTestId('test-footer')).toBeInTheDocument();
    });

    it('should render skillSlot in desktop view', () => {
      const skillSlot = <div data-testid="skill-slot">Skill Area</div>;
      render(<SessionSidebar {...buildProps({ skillSlot })} />);

      expect(screen.getByTestId('skill-slot')).toBeInTheDocument();
    });

    it('should call onNewChat when new chat button is clicked', async () => {
      const user = userEvent.setup();
      const onNewChat = vi.fn();
      render(<SessionSidebar {...buildProps({ onNewChat })} />);

      const newChatButton = screen.getByRole('button', { name: 'New chat' });
      await user.click(newChatButton);

      expect(onNewChat).toHaveBeenCalledOnce();
    });
  });

  // -- Edge cases --

  describe('Edge cases', () => {
    it('should render with an empty sessions array without crashing', () => {
      const { container } = render(<SessionSidebar {...buildProps({ sessions: [] })} />);

      expect(container).toBeTruthy();
    });

    it('should render with many sessions without crashing', () => {
      const sessions = Array.from({ length: 50 }, (_, i) => ({
        id: `session-${i}`,
        title: `Session ${i}`,
      }));
      const { container } = render(<SessionSidebar {...buildProps({ sessions })} />);

      expect(container).toBeTruthy();
    });

    it('should render with no optional props without crashing', () => {
      const { container } = render(
        <SessionSidebar
          sessions={[]}
          activeSessionId={null}
          canCreateSession={true}
          onNewChat={vi.fn()}
          onSelectSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      );

      expect(container).toBeTruthy();
    });

    it('should render session with a very long title without crashing', () => {
      const sessions = [{ id: 'long-session', title: 'S'.repeat(500) }];
      const { container } = render(<SessionSidebar {...buildProps({ sessions })} />);

      expect(container).toBeTruthy();
    });

    it('should render with activeSessionId set to a valid session id', () => {
      const sessions = [{ id: 'session-1', title: 'Chat 1' }];
      const { container } = render(
        <SessionSidebar {...buildProps({ sessions, activeSessionId: 'session-1' })} />
      );

      expect(container).toBeTruthy();
    });
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <SessionSidebar
        sessions={[{ id: 'session-1', title: 'Test Chat' }]}
        activeSessionId="session-1"
        canCreateSession={true}
        onNewChat={vi.fn()}
        onSelectSession={vi.fn()}
        onDeleteSession={vi.fn()}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
