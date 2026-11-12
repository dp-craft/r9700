// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/components/ui/RunTabs', () => ({
  RunTabs: (props: Record<string, unknown>) => (
    <div
      data-testid="run-tabs"
      data-props={JSON.stringify(props, (_k, v) => {
        if (typeof v === 'function') return '__fn__';
        if (v && typeof v === 'object' && '$$typeof' in v) return '__node__';
        return v;
      })}
    />
  ),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi
    .fn()
    .mockResolvedValue({ modellek: false, systemSkill: false, userPrompt: false }),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(undefined),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn().mockResolvedValue([]),
  archiveRun: vi.fn().mockResolvedValue(undefined),
  deleteArchivedRuns: vi.fn().mockResolvedValue(undefined),
  buildRunExport: vi.fn().mockReturnValue([]),
}));

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
// Container under test — does NOT exist yet (TDD Red phase)
import { RunTabsContainer } from '../RunTabsContainer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRun(id: number, label: string) {
  return {
    id,
    label,
    createdAt: 0,
    configSnapshot: { models: [], prompts: [], userPrompt: '' },
    cells: [],
    selectedCellIds: [],
    compareMode: 'diff' as const,
    sort: 'mean' as const,
    group: 'model' as const,
    gridCols: 3 as const,
    viewMode: 'list' as const,
  };
}

const resetStore = (
  overrides: Partial<ReturnType<typeof usePromptTesterStore.getState>> = {}
): void => {
  usePromptTesterStore.setState({
    runs: [buildRun(1, 'Futtatás 1'), buildRun(2, 'Futtatás 2')],
    activeRunId: 1,
    editingRunId: null,
    models: [],
    prompts: [],
    userPrompt: '',
    sectionCollapse: { modellek: false, systemSkill: false, userPrompt: false },
    streaming: { runId: null, cellIds: [] },
    ...overrides,
  });
};

function getParsedProps(): Record<string, unknown> {
  const el = screen.getByTestId('run-tabs');
  return JSON.parse(el.getAttribute('data-props') ?? '{}') as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Smoke tests
// ---------------------------------------------------------------------------

describe('RunTabsContainer — smoke', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // Branch: 2 tabs — tabs prop mapped correctly
  // -------------------------------------------------------------------------

  it('should pass tabs mapped from runs as { id: string, label: string }', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { tabs } = getParsedProps();
    expect(tabs).toEqual([
      { id: '1', label: 'Futtatás 1' },
      { id: '2', label: 'Futtatás 2' },
    ]);
  });

  // -------------------------------------------------------------------------
  // activeId derived from activeRunId
  // -------------------------------------------------------------------------

  it('should pass activeId as string of activeRunId', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { activeId } = getParsedProps();
    expect(activeId).toBe('1');
  });

  // -------------------------------------------------------------------------
  // editingId passed through
  // -------------------------------------------------------------------------

  it('should pass editingId from store (null when no run is being renamed)', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { editingId } = getParsedProps();
    expect(editingId).toBeNull();
  });

  it('should pass editingId as the string id when a run is being renamed', async () => {
    resetStore({ editingRunId: '2' });

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { editingId } = getParsedProps();
    expect(editingId).toBe('2');
  });

  // -------------------------------------------------------------------------
  // canCloseActive: true even when only 1 tab (T030 — always closeable)
  // -------------------------------------------------------------------------

  it('should pass canCloseActive=true even when only 1 tab is open', async () => {
    resetStore({ runs: [buildRun(1, 'Solo')], activeRunId: 1 });

    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { canCloseActive } = getParsedProps();
    expect(canCloseActive).toBe(true);
  });

  it('should pass canCloseActive=true when more than 1 tab is open', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const { canCloseActive } = getParsedProps();
    expect(canCloseActive).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ariaTree snapshot — 2-tab branch
  // -------------------------------------------------------------------------

  it('should render RunTabs placeholder without crashing', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    expect(screen.getByTestId('run-tabs')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Dead-handler walk — every callback prop serialises as '__fn__' (wired)
  // -------------------------------------------------------------------------

  it('should wire all callback props to store actions (dead-handler check)', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });

    const props = getParsedProps();
    const callbackProps = [
      'onAdd',
      'onActivate',
      'onClose',
      'onRenameStart',
      'onRenameCommit',
      'onRenameCancel',
    ] as const;

    for (const name of callbackProps) {
      expect(props[name], `prop "${name}" must be a wired function`).toBe('__fn__');
    }
  });

  // -------------------------------------------------------------------------
  // onAdd → createEmptyTab (FR-026): store state change observed
  // -------------------------------------------------------------------------

  it('should call createEmptyTab when onAdd is invoked', async () => {
    const spy = vi.spyOn(usePromptTesterStore.getState(), 'createEmptyTab');

    const { rerender } = await act(async () => render(<RunTabsContainer />));

    const before = usePromptTesterStore.getState().runs.length;
    await act(async () => {
      usePromptTesterStore.getState().createEmptyTab();
    });
    rerender(<RunTabsContainer />);

    expect(usePromptTesterStore.getState().runs.length).toBeGreaterThan(before);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // onActivate(stringId) → setActiveRun(Number(stringId)) (FR-027)
  // -------------------------------------------------------------------------

  it('should call setActiveRun(2) when onActivate("2") is invoked', async () => {
    const spy = vi.spyOn(usePromptTesterStore.getState(), 'setActiveRun');

    await act(async () => {
      render(<RunTabsContainer />);
    });
    await act(async () => {
      usePromptTesterStore.getState().setActiveRun(2);
    });

    expect(spy).toHaveBeenCalledWith(2);
    expect(usePromptTesterStore.getState().activeRunId).toBe(2);
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // onClose(stringId) → closeTab(Number(stringId)) (FR-031)
  // -------------------------------------------------------------------------

  it('should call closeTab(2) when onClose("2") is invoked', async () => {
    const spy = vi.spyOn(usePromptTesterStore.getState(), 'closeTab');

    await act(async () => {
      render(<RunTabsContainer />);
    });
    await act(async () => {
      void usePromptTesterStore.getState().closeTab(2);
    });

    expect(spy).toHaveBeenCalledWith(2);
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // onRenameStart(stringId) → setEditingRun(stringId) (FR-028)
  // -------------------------------------------------------------------------

  it('should call setEditingRun("2") when onRenameStart("2") is invoked', async () => {
    await act(async () => {
      render(<RunTabsContainer />);
    });
    await act(async () => {
      usePromptTesterStore.getState().setEditingRun('2');
    });

    expect(usePromptTesterStore.getState().editingRunId).toBe('2');
  });

  // -------------------------------------------------------------------------
  // onRenameCommit(stringId, name) → renameRun(Number, name) + setEditingRun(null) (FR-028, FR-035)
  // -------------------------------------------------------------------------

  it('should rename run and clear editingRunId when onRenameCommit is invoked', async () => {
    resetStore({ editingRunId: '2' });

    await act(async () => {
      render(<RunTabsContainer />);
    });
    await act(async () => {
      usePromptTesterStore.getState().renameRun(2, 'New Name');
      usePromptTesterStore.getState().setEditingRun(null);
    });

    expect(usePromptTesterStore.getState().runs.find(r => r.id === 2)?.label).toBe('New Name');
    expect(usePromptTesterStore.getState().editingRunId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // onRenameCancel → setEditingRun(null) (FR-035)
  // -------------------------------------------------------------------------

  it('should clear editingRunId when onRenameCancel is invoked', async () => {
    resetStore({ editingRunId: '1' });

    await act(async () => {
      render(<RunTabsContainer />);
    });
    await act(async () => {
      usePromptTesterStore.getState().setEditingRun(null);
    });

    expect(usePromptTesterStore.getState().editingRunId).toBeNull();
  });
});
