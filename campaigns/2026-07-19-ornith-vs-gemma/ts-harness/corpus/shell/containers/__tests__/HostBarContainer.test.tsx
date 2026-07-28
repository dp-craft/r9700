import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks --

let labEnabled = true;

vi.mock('@/features/settings', () => ({
  useFeatureFlagStore: Object.assign(
    (selector: (s: { flags: Record<string, boolean> }) => unknown) =>
      selector({ flags: { 'prompt-lab-enabled': labEnabled } }),
    {
      getState: vi.fn(() => ({ flags: { 'prompt-lab-enabled': labEnabled } })),
      setState: vi.fn(),
    }
  ),
  useSettingsStore: Object.assign(
    (selector: (s: { themeMode: string; setThemeMode: () => void }) => unknown) =>
      selector({ themeMode: 'system', setThemeMode: vi.fn() }),
    { getState: vi.fn(), setState: vi.fn() }
  ),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => {
    const map: Record<string, string> = {
      'shell.mf.label.chat': 'Chat',
      'shell.mf.label.prompt-lab': 'Prompt Lab',
      'shell.openSettings': 'Open settings',
      'shell.appName': 'AiChatney',
    };
    return map[key] ?? key;
  },
}));

vi.mock('@/shell/components/ThemeSwitchContainer', () => ({
  ThemeSwitchContainer: () => <div data-testid="theme-switch" />,
}));

vi.mock('@/shell/containers/BackgroundStreamIndicatorContainer', () => ({
  BackgroundStreamIndicatorContainer: () => <div data-testid="bg-stream-indicator" />,
}));

vi.mock('@/shell/components/HostBar', () => ({
  HostBar: (props: {
    readonly logoSlot: React.ReactNode;
    readonly pillsSlot: React.ReactNode;
    readonly themeSwitchSlot: React.ReactNode;
    readonly settingsSlot: React.ReactNode;
    readonly accentColor: 'blue' | 'purple';
    readonly indicatorSlot?: React.ReactNode;
  }) => {
    return (
      <header data-testid="host-bar">
        {props.accentColor === 'blue' && <div data-testid="accent-stripe" className="bg-mf-chat" />}
        {props.accentColor === 'purple' && (
          <div data-testid="accent-stripe" className="bg-mf-lab" />
        )}
        {props.logoSlot}
        {props.pillsSlot}
        {props.themeSwitchSlot}
        {props.settingsSlot}
        {props.indicatorSlot}
      </header>
    );
  },
}));

// -- Import after mocks --

import { useUIStore } from '@/stores/useUIStore';

import { HostBarContainer } from '../HostBarContainer';

// -- Helpers --

const resetStore = () => {
  useUIStore.setState({
    workspace: 'chat',
    activeDialog: null,
    dialogPayload: null,
  });
};

// -- Tests --

beforeEach(() => {
  labEnabled = true;
  vi.clearAllMocks();
  resetStore();
});

describe('HostBarContainer', () => {
  describe('MF pills', () => {
    it('should render Chat pill with i18n label when workspace is chat', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument();
    });

    it('should render Prompt Lab pill with i18n label when workspace is chat', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      expect(screen.getByRole('button', { name: 'Prompt Lab' })).toBeInTheDocument();
    });
  });

  describe('Settings button', () => {
    it('should have accessible name from shell.openSettings when rendered', () => {
      render(<HostBarContainer />);

      expect(screen.getByRole('button', { name: 'Open settings' })).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should set workspace to chat when Chat pill is clicked', async () => {
      useUIStore.setState({ workspace: 'prompt-lab' });
      const user = userEvent.setup();

      render(<HostBarContainer />);
      await user.click(screen.getByRole('button', { name: 'Chat' }));

      expect(useUIStore.getState().workspace).toBe('chat');
    });

    it('should set workspace to prompt-lab when Prompt Lab pill is clicked', async () => {
      useUIStore.setState({ workspace: 'chat' });
      const user = userEvent.setup();

      render(<HostBarContainer />);
      await user.click(screen.getByRole('button', { name: 'Prompt Lab' }));

      expect(useUIStore.getState().workspace).toBe('prompt-lab');
    });
  });

  describe('Settings dialog', () => {
    it('should open settings dialog when settings button is clicked', async () => {
      useUIStore.setState({ activeDialog: null });
      const user = userEvent.setup();

      render(<HostBarContainer />);
      await user.click(screen.getByRole('button', { name: 'Open settings' }));

      expect(useUIStore.getState().activeDialog).toBe('settings');
    });
  });

  describe('Accent color', () => {
    it('should pass accentColor blue to HostBar when workspace is chat', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);
      const stripe = screen.getByTestId('accent-stripe');

      expect(stripe.className.includes('bg-mf-chat')).toBe(true);
    });

    it('should pass accentColor purple to HostBar when workspace is prompt-lab', () => {
      useUIStore.setState({ workspace: 'prompt-lab' });

      render(<HostBarContainer />);
      const stripe = screen.getByTestId('accent-stripe');

      expect(stripe.className.includes('bg-mf-lab')).toBe(true);
    });
  });

  describe('FR-006 — no avatar', () => {
    it('should not render any avatar image element when rendered', () => {
      render(<HostBarContainer />);

      expect(screen.queryByRole('img', { name: /avatar/i })).toBeNull();
    });

    it('should not render any avatar text when rendered', () => {
      render(<HostBarContainer />);

      expect(screen.queryByText(/avatar/i)).toBeNull();
    });
  });

  describe('T039 — Background stream indicator', () => {
    it('should pass indicatorSlot to HostBar when rendered', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      expect(screen.getByTestId('bg-stream-indicator')).toBeInTheDocument();
    });
  });

  describe('T035 — Flag-gate', () => {
    it('should hide Prompt Lab pill when prompt-lab-enabled flag is false', () => {
      labEnabled = false;
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      expect(screen.queryByRole('button', { name: 'Prompt Lab' })).toBeNull();
    });

    it('should mark Chat pill active when workspace is chat', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      const chatPill = screen.getByRole('button', { name: 'Chat' });
      expect(chatPill).toHaveAttribute('aria-current', 'page');
    });

    it('should mark Prompt Lab pill active when workspace is prompt-lab', () => {
      labEnabled = true;
      useUIStore.setState({ workspace: 'prompt-lab' });

      render(<HostBarContainer />);

      const labPill = screen.getByRole('button', { name: 'Prompt Lab' });
      expect(labPill).toHaveAttribute('aria-current', 'page');
    });
  });
});
