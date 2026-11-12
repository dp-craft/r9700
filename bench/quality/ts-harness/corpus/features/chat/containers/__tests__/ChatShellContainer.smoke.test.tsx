// Boundary mocks — declared before imports (Vitest hoisting)
// useUIStore is the REAL store; seeded via setState in beforeEach (ADR-018 L3 real-store rule).

vi.mock('@/db/appSettings', () => ({
  putAppSetting: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shell/hooks/useMFRailItems', () => ({
  useMFRailItems: vi.fn(),
}));

vi.mock('@/shell/containers/SkillsPanelContainer', () => ({
  SkillsPanelContainer: () => <div data-testid="skills-panel-sentinel" />,
}));

vi.mock('../ChatWindowContainer', () => ({
  ChatWindowContainer: () => <div data-testid="chat-window" />,
}));

vi.mock('@/features/sessions', () => ({
  SessionSidebarContainer: () => null,
  SidebarFooterContainer: () => null,
  useSessionStore: vi.fn((selector?: (s: unknown) => unknown) => {
    const state = {
      sessionList: [],
      activeSessionId: null,
      setSessionModel: vi.fn(),
      setSessionProviderAndModel: vi.fn(),
      setSessionWebSearch: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../ChatHeaderContainer', () => ({
  ChatHeaderContainer: () => <div data-testid="chat-header-stub" />,
}));

vi.mock('@/features/skills', () => ({
  CommandAutocompleteContainer: () => null,
  SessionSkillIndicatorContainer: () => null,
  SkillsPageContainer: () => null,
  useSkillStore: vi.fn(() => ({})),
}));

vi.mock('@/i18n', async importOriginal => {
  const actual = await importOriginal<typeof import('@/i18n')>();
  return {
    ...actual,
    useTranslation: () => (key: string) => key,
  };
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { putAppSetting } from '@/db/appSettings';
import { useMFRailItems } from '@/shell/hooks/useMFRailItems';
import { useUIStore } from '@/stores/useUIStore';

import { ChatShellContainer } from '../ChatShellContainer';

const mockOnSelect = vi.fn();

const seedStore = (chatPanel: 'conversations' | 'skills' = 'conversations'): void => {
  useUIStore.setState({ chatPanel });
};

const seedRailItems = (): void => {
  vi.mocked(useMFRailItems).mockReturnValue({
    items: [
      {
        id: 'chat-conversations',
        icon: () => null,
        labelKey: 'shell.chat.rail.conversations',
        panelKey: 'conversations',
      },
      {
        id: 'chat-skills',
        icon: () => null,
        labelKey: 'shell.rail.skills',
        panelKey: 'skills',
      },
    ] as never,
    activePanelKey: 'conversations',
    onSelect: mockOnSelect,
  });
};

describe('ChatShellContainer — L3 smoke (chatPanel wiring)', () => {
  beforeEach(() => {
    mockOnSelect.mockClear();
    vi.mocked(putAppSetting).mockResolvedValue(undefined);
    seedStore();
    seedRailItems();
  });

  it('should render chat window when chatPanel is conversations', () => {
    seedStore('conversations');
    render(<ChatShellContainer />);

    expect(screen.getByTestId('chat-window')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-panel-sentinel')).not.toBeInTheDocument();
  });

  it('should render SkillsPanelContainer when chatPanel is skills', () => {
    seedStore('skills');
    render(<ChatShellContainer />);

    expect(screen.getByTestId('skills-panel-sentinel')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-window')).not.toBeInTheDocument();
  });

  it('should call rail.onSelect with panel key when rail item clicked', async () => {
    const user = userEvent.setup();
    render(<ChatShellContainer />);

    const conversationsButton = screen.getByRole('button', {
      name: (name: string) => name.toLowerCase().includes('conversation'),
    });
    await user.click(conversationsButton);

    expect(mockOnSelect).toHaveBeenCalledWith('conversations');
  });

  // NEW:chat.unified-column-layout — MfLayoutSkeleton integration assertions (RED — not yet implemented)
  describe('MfLayoutSkeleton structural layout (conversations panel)', () => {
    it('should render mf-layout-skeleton root when chatPanel is conversations', () => {
      seedStore('conversations');
      render(<ChatShellContainer />);

      expect(screen.getByTestId('mf-layout-skeleton')).toBeInTheDocument();
    });

    it('should render layout-header, left-column, and right-column inside mf-layout-skeleton', () => {
      seedStore('conversations');
      const { container } = render(<ChatShellContainer />);

      const skeleton = container.querySelector('[data-testid="mf-layout-skeleton"]');
      expect(skeleton).not.toBeNull();
      expect(skeleton?.querySelector('[data-testid="layout-header"]')).not.toBeNull();
      expect(skeleton?.querySelector('[data-testid="left-column"]')).not.toBeNull();
      expect(skeleton?.querySelector('[data-testid="right-column"]')).not.toBeNull();
    });

    it('should render layout-header before left-column and right-column in DOM order', () => {
      seedStore('conversations');
      const { container } = render(<ChatShellContainer />);

      const skeleton = container.querySelector('[data-testid="mf-layout-skeleton"]');
      const allTestIds = Array.from(skeleton?.querySelectorAll('[data-testid]') ?? []).map(
        (el: Element) => el.getAttribute('data-testid')
      );

      const headerIdx = allTestIds.indexOf('layout-header');
      const leftIdx = allTestIds.indexOf('left-column');
      const rightIdx = allTestIds.indexOf('right-column');

      expect(headerIdx).toBeGreaterThanOrEqual(0);
      expect(headerIdx).toBeLessThan(leftIdx);
      expect(headerIdx).toBeLessThan(rightIdx);
    });

    it('should render the chat window inside right-column', () => {
      seedStore('conversations');
      const { container } = render(<ChatShellContainer />);

      const rightColumn = container.querySelector('[data-testid="right-column"]');
      expect(rightColumn).not.toBeNull();
      expect(rightColumn?.querySelector('[data-testid="chat-window"]')).not.toBeNull();
    });
  });
});
