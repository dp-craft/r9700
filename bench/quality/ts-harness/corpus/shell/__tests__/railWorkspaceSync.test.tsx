import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MFInnerRailItem } from '@/shell/types';

// -- Boundary mocks --
// T072 risk-1: both rail consumers derive from the single `workspace` source.
// This test verifies useMFRailItems() and HostBarContainer stay in sync after
// setWorkspace(ws) — there is no second source of truth to drift out of sync.

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
  }) => (
    <header data-testid="host-bar">
      {props.logoSlot}
      {props.pillsSlot}
      {props.themeSwitchSlot}
      {props.settingsSlot}
      {props.indicatorSlot}
    </header>
  ),
}));

// -- Import after mocks --

import { useUIStore, type Workspace } from '@/stores/useUIStore';

import { HostBarContainer } from '../containers/HostBarContainer';
import { useMFRailItems } from '../hooks/useMFRailItems';

// -- Fixtures --

const EXPECTED_PANEL_KEYS: Record<Workspace, readonly string[]> = {
  chat: ['conversations', 'skills'],
  'prompt-lab': ['tester', 'run-history', 'prompt-history', 'skills'],
};

const WORKSPACES: readonly Workspace[] = ['chat', 'prompt-lab'];
const OTHER: Record<Workspace, Workspace> = { chat: 'prompt-lab', 'prompt-lab': 'chat' };

beforeEach(() => {
  vi.clearAllMocks();
  act(() => {
    useUIStore.setState({ workspace: 'chat', chatPanel: 'conversations', labPanel: 'tester' });
  });
});

describe('rail workspace sync (T072 risk-1)', () => {
  describe('Given setWorkspace(ws) drives both consumers from one source', () => {
    it.each(
      WORKSPACES
    )('should make useMFRailItems item set match workspace when setWorkspace(%s)', ws => {
      act(() => {
        useUIStore.getState().setWorkspace(ws);
      });

      const { result } = renderHook(() => useMFRailItems());

      expect(result.current.items.map((i: MFInnerRailItem) => i.panelKey)).toEqual(
        EXPECTED_PANEL_KEYS[ws]
      );
    });

    it.each(
      WORKSPACES
    )('should mark only the mf-pill-%s active in HostBarContainer when setWorkspace(%s)', ws => {
      act(() => {
        useUIStore.getState().setWorkspace(ws);
      });

      render(<HostBarContainer />);
      const activePill = screen.getByTestId(`mf-pill-${ws}`);
      const otherPill = screen.getByTestId(`mf-pill-${OTHER[ws]}`);

      // active rule mirrors HostBarContainer: workspace === meta.id
      expect(activePill).toHaveAttribute('aria-current', 'page');
      expect(otherPill).not.toHaveAttribute('aria-current', 'page');
    });

    it.each(
      WORKSPACES
    )('should keep rail item set and active pill in sync when setWorkspace(%s)', ws => {
      act(() => {
        useUIStore.getState().setWorkspace(ws);
      });

      const { result } = renderHook(() => useMFRailItems());
      render(<HostBarContainer />);

      const railMatchesWorkspace =
        JSON.stringify(result.current.items.map((i: MFInnerRailItem) => i.panelKey)) ===
        JSON.stringify(EXPECTED_PANEL_KEYS[ws]);
      const pillActive =
        screen.getByTestId(`mf-pill-${ws}`).getAttribute('aria-current') === 'page';

      // both derive from getState().workspace — they cannot disagree
      expect(useUIStore.getState().workspace).toBe(ws);
      expect(railMatchesWorkspace).toBe(true);
      expect(pillActive).toBe(true);
    });
  });
});
