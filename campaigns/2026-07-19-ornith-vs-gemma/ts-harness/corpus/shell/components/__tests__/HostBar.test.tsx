import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (hoisted before imports) --

vi.mock('@/features/settings', () => ({
  useFeatureFlagStore: Object.assign(
    (selector: (s: { flags: Record<string, boolean> }) => unknown) =>
      selector({ flags: { 'prompt-lab-enabled': true } }),
    {
      getState: vi.fn(() => ({ flags: { 'prompt-lab-enabled': true } })),
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

vi.mock('@/shell/containers/ThemeSwitchContainer', () => ({
  ThemeSwitchContainer: () => <div data-testid="theme-switch" />,
}));

// -- Imports after mocks --

import { HostBarContainer } from '@/shell/containers/HostBarContainer';
import { useUIStore } from '@/stores/useUIStore';

import { HostBar, type HostBarProps } from '../HostBar';

// -- Builders --

const buildProps = (overrides?: Partial<HostBarProps>): HostBarProps => ({
  logoSlot: <span>Logo</span>,
  pillsSlot: <div>Pills</div>,
  themeSwitchSlot: <div>ThemeSwitch</div>,
  settingsSlot: <button type="button">Settings</button>,
  accentColor: 'blue',
  ...overrides,
});

const resetStore = () => {
  useUIStore.setState({
    workspace: 'chat',
    activeDialog: null,
    dialogPayload: null,
  });
};

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('HostBar', () => {
  it('should match snapshot when accentColor is blue (chat)', () => {
    const { asFragment } = render(<HostBar {...buildProps({ accentColor: 'blue' })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot when accentColor is purple (lab)', () => {
    const { asFragment } = render(<HostBar {...buildProps({ accentColor: 'purple' })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should render indicatorSlot content between pills and settings button', () => {
    render(
      <HostBar
        {...buildProps({
          indicatorSlot: <span data-testid="indicator">active</span>,
        })}
      />
    );

    expect(screen.getByTestId('indicator')).toBeInTheDocument();
  });
});

describe('HostBarContainer — MF switcher segmented button group (T020)', () => {
  describe('Segment container structure', () => {
    it('should render the switcher wrapper with rounded group class matching ThemeSwitch style when chat is active', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      // The switcher group container must use rounded-md overflow-hidden (ThemeSwitch style).
      // Currently uses gap-1 flex div — this assertion will FAIL until T020 is applied.
      const chatBtn = screen.getByRole('button', { name: /Chat/i });
      const wrapper = chatBtn.parentElement;

      expect(wrapper?.className).toContain('overflow-hidden');
      expect(wrapper?.className).toContain('rounded-md');
    });

    it('should render Chat segment with h-8 and rounded-none classes matching ThemeSwitch segment style', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      // Segments MUST use h-8 rounded-none border-0 (same as ThemeSwitch segmentClass).
      // Currently uses h-9 rounded-md — this assertion will FAIL until T020 is applied.
      const chatBtn = screen.getByRole('button', { name: /Chat/i });

      expect(chatBtn.className).toContain('h-8');
      expect(chatBtn.className).toContain('rounded-none');
      expect(chatBtn.className).toContain('border-0');
    });

    it('should render Prompt Lab segment with h-8 and rounded-none classes matching ThemeSwitch segment style', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      const labBtn = screen.getByRole('button', { name: /Prompt Lab/i });

      expect(labBtn.className).toContain('h-8');
      expect(labBtn.className).toContain('rounded-none');
      expect(labBtn.className).toContain('border-0');
    });
  });

  describe('Active / inactive segment accent state', () => {
    it('should apply accent classes to Chat segment when chat is the active workspace', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      // Active segment MUST have bg-accent text-accent-foreground (ThemeSwitch active style).
      const chatBtn = screen.getByRole('button', { name: /Chat/i });

      expect(chatBtn.className).toContain('bg-accent');
      expect(chatBtn.className).toContain('text-accent-foreground');
    });

    it('should apply muted classes to Prompt Lab segment when chat is the active workspace', () => {
      useUIStore.setState({ workspace: 'chat' });

      render(<HostBarContainer />);

      // Inactive segment MUST have text-muted-foreground (ThemeSwitch inactive style).
      const labBtn = screen.getByRole('button', { name: /Prompt Lab/i });

      expect(labBtn.className).toContain('text-muted-foreground');
      expect(labBtn.className).not.toContain('bg-accent');
    });

    it('should apply accent classes to Prompt Lab segment and muted to Chat when prompt-lab is active', () => {
      useUIStore.setState({ workspace: 'prompt-lab' });

      render(<HostBarContainer />);

      const labBtn = screen.getByRole('button', { name: /Prompt Lab/i });
      const chatBtn = screen.getByRole('button', { name: /Chat/i });

      expect(labBtn.className).toContain('bg-accent');
      expect(chatBtn.className).not.toContain('bg-accent');
    });
  });

  describe('Navigation (FR-030 — existing behavior preserved)', () => {
    it('should set workspace to chat when Chat segment is clicked', async () => {
      useUIStore.setState({ workspace: 'prompt-lab' });
      const user = userEvent.setup();

      render(<HostBarContainer />);
      await user.click(screen.getByRole('button', { name: /Chat/i }));

      expect(useUIStore.getState().workspace).toBe('chat');
    });

    it('should set workspace to prompt-lab when Prompt Lab segment is clicked', async () => {
      useUIStore.setState({ workspace: 'chat' });
      const user = userEvent.setup();

      render(<HostBarContainer />);
      await user.click(screen.getByRole('button', { name: /Prompt Lab/i }));

      expect(useUIStore.getState().workspace).toBe('prompt-lab');
    });
  });
});
