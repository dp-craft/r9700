import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/types';
import type { MFInnerRailItem } from '@/shell/types';
import { useUIStore } from '@/stores/useUIStore';

import { useMFRailItems } from '../useMFRailItems';

// -- Boundary mocks --

vi.mock('@/features/settings/stores/useSettingsStore', () => ({
  useSettingsStore: vi.fn((selector: (state: { uiLanguage: Locale }) => unknown) =>
    selector({ uiLanguage: 'hu' as Locale })
  ),
}));

// -- Tests --

describe('useMFRailItems', () => {
  beforeEach(() => {
    act(() => {
      useUIStore.setState({ workspace: 'chat', chatPanel: 'conversations', labPanel: 'tester' });
    });
  });

  // =========================================================================
  // Locked case 1: workspace='chat' → items=[conversations, skills]
  // =========================================================================

  it('should return exactly 2 items when workspace is chat', () => {
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.items).toHaveLength(2);
  });

  it('should return conversations and skills panel keys in order when workspace is chat', () => {
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.items.map((i: MFInnerRailItem) => i.panelKey)).toEqual([
      'conversations',
      'skills',
    ]);
  });

  // =========================================================================
  // Locked case 2: workspace='prompt-lab' → items=[tester, run-history, prompt-history, skills]
  // =========================================================================

  it('should return exactly 4 items when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.items).toHaveLength(4);
  });

  it('should return tester run-history prompt-history skills panel keys in order when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.items.map((i: MFInnerRailItem) => i.panelKey)).toEqual([
      'tester',
      'run-history',
      'prompt-history',
      'skills',
    ]);
  });

  // =========================================================================
  // Locked case 3: item set is pure function of workspace only
  // =========================================================================

  it('should not change chat items when chatPanel changes', () => {
    const { result, rerender } = renderHook(() => useMFRailItems());
    const initialKeys = result.current.items.map((i: MFInnerRailItem) => i.panelKey);

    act(() => {
      useUIStore.setState({ chatPanel: 'skills' });
    });
    rerender();

    expect(result.current.items.map((i: MFInnerRailItem) => i.panelKey)).toEqual(initialKeys);
  });

  it('should not change lab items when labPanel changes', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result, rerender } = renderHook(() => useMFRailItems());
    const initialKeys = result.current.items.map((i: MFInnerRailItem) => i.panelKey);

    act(() => {
      useUIStore.setState({ labPanel: 'run-history' });
    });
    rerender();

    expect(result.current.items.map((i: MFInnerRailItem) => i.panelKey)).toEqual(initialKeys);
  });

  // =========================================================================
  // Locked case 4: activePanelKey = active workspace's T1 panel
  // =========================================================================

  it('should return activePanelKey equal to chatPanel when workspace is chat', () => {
    act(() => {
      useUIStore.setState({ workspace: 'chat', chatPanel: 'skills' });
    });
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.activePanelKey).toBe('skills');
  });

  it('should return activePanelKey equal to labPanel when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab', labPanel: 'run-history' });
    });
    const { result } = renderHook(() => useMFRailItems());

    expect(result.current.activePanelKey).toBe('run-history');
  });

  // =========================================================================
  // Locked case 5: onSelect routes to active workspace's T1 slice
  // =========================================================================

  it('should call setChatPanel when onSelect is called in chat workspace', () => {
    const { result } = renderHook(() => useMFRailItems());

    act(() => {
      result.current.onSelect('skills');
    });

    expect(useUIStore.getState().chatPanel).toBe('skills');
    expect(useUIStore.getState().workspace).toBe('chat');
  });

  it('should call setLabPanel when onSelect is called in prompt-lab workspace', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    act(() => {
      result.current.onSelect('run-history');
    });

    expect(useUIStore.getState().labPanel).toBe('run-history');
    expect(useUIStore.getState().workspace).toBe('prompt-lab');
  });

  it('should not change workspace when onSelect is called', () => {
    const { result } = renderHook(() => useMFRailItems());

    act(() => {
      result.current.onSelect('skills');
    });

    expect(useUIStore.getState().workspace).toBe('chat');
  });

  // =========================================================================
  // Item shape
  // =========================================================================

  it('should return items with non-empty id, translated labelKey, truthy icon, and panelKey', () => {
    const { result } = renderHook(() => useMFRailItems());
    const first = result.current.items[0];

    expect(typeof first.id).toBe('string');
    expect(first.id.length).toBeGreaterThan(0);
    expect(first.labelKey).toBe('Beszélgetések');
    expect(first.icon).toBeTruthy();
    expect(typeof first.panelKey).toBe('string');
    expect(first.panelKey.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Reactivity
  // =========================================================================

  it('should transition items when workspace changes from chat to prompt-lab', () => {
    const { result, rerender } = renderHook(() => useMFRailItems());
    expect(result.current.items[0].panelKey).toBe('conversations');

    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    rerender();

    expect(result.current.items).toHaveLength(4);
    expect(result.current.items[0].panelKey).toBe('tester');
  });

  // =========================================================================
  // Rail item presence
  // =========================================================================

  it('should include lab-prompt-history item when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'lab-prompt-history');
    expect(item).toBeDefined();
    expect(item?.panelKey).toBe('prompt-history');
  });

  it('should NOT include lab-prompt-history item when workspace is chat', () => {
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'lab-prompt-history');
    expect(item).toBeUndefined();
  });

  it('should include lab-run-history item when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'lab-run-history');
    expect(item).toBeDefined();
    expect(item?.panelKey).toBe('run-history');
  });

  it('should NOT include lab-run-history item when workspace is chat', () => {
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'lab-run-history');
    expect(item).toBeUndefined();
  });

  it('should include chat-skills item when workspace is chat', () => {
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'chat-skills');
    expect(item).toBeDefined();
    expect(item?.panelKey).toBe('skills');
  });

  it('should include lab-skills item when workspace is prompt-lab', () => {
    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });
    const { result } = renderHook(() => useMFRailItems());

    const item = result.current.items.find((i: MFInnerRailItem) => i.id === 'lab-skills');
    expect(item).toBeDefined();
    expect(item?.panelKey).toBe('skills');
  });
});
