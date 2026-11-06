/**
 * CANONICAL "DEAD-HANDLER SMOKE TEST" PATTERN
 * ============================================
 * Purpose: verify that every <button> rendered by a container causes an
 * observable change in the Zustand store (or external state) when clicked.
 * A button with no onClick — a "dead handler" — will produce zero change
 * and the assertion will fail, naming the button by accessible text + index.
 *
 * How to copy this template for another container:
 *  1. Replace the vi.mock() boundary list with whatever the new container needs.
 *  2. Replace `LeftColumnContainer` import + render call.
 *  3. Keep the button-walk loop and store-snapshot diff verbatim.
 *  4. Adjust `resetStore()` to seed the minimum state needed to render buttons.
 *
 * This test intentionally runs in RED on un-fixed code (dead handlers present)
 * and turns GREEN only after every button has a wired onClick.
 */

// jsdom does not implement window.matchMedia — stub it as a boundary mock.
// matches: true forces the desktop layout so buttons are rendered (not the
// "Best viewed on desktop" fallback).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});

// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('@/services/llm/stream', () => ({ streamChat: vi.fn() }));

vi.mock('@/db/appSettings', () => ({
  // Return a fully-formed collapse record so loadSectionCollapse does not crash
  getLabSectionCollapse: vi
    .fn()
    .mockResolvedValue({ modellek: false, systemSkill: false, userPrompt: false }),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// Stub out the cross-feature skills dialog — it has its own store deps
vi.mock('@/features/skills', () => {
  const useSkillStoreStub = (
    selector?: (s: { skills: readonly unknown[]; containers: readonly unknown[] }) => unknown
  ) => {
    const state = { skills: [] as readonly unknown[], containers: [] as readonly unknown[] };
    return selector ? selector(state) : state;
  };
  (useSkillStoreStub as unknown as { getState: () => unknown }).getState = () => ({
    skills: [] as readonly unknown[],
    containers: [] as readonly unknown[],
  });
  return {
    Picker1DialogContainer: () => null,
    CommandAutocompleteContainer: () => null,
    SessionSkillIndicatorContainer: () => null,
    useSkillStore: useSkillStoreStub,
  };
});

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as appSettings from '@/db/appSettings';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { LeftColumnContainer } from '../LeftColumnContainer';

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

const resetStore = (): void => {
  usePromptTesterStore.setState({
    models: [],
    prompts: [],
    userPrompt: '',
    runs: [
      {
        id: 1,
        label: 'Futtatás 1',
        createdAt: 0,
        configSnapshot: { models: [], prompts: [], userPrompt: '' },
        cells: [],
        selectedCellIds: [],
        compareMode: 'diff',
        sort: 'mean',
        group: 'model',
        gridCols: 3,
        viewMode: 'list',
      },
    ],
    activeRunId: 1,
    sectionCollapse: { modellek: false, systemSkill: false, userPrompt: false },
    streaming: { runId: null, cellIds: [] },
  });
};

// ---------------------------------------------------------------------------
// Dead-handler smoke test
// ---------------------------------------------------------------------------

describe('LeftColumnContainer — dead-handler smoke', () => {
  beforeEach(() => {
    // mockReset: true (vitest config) clears mockResolvedValue between tests —
    // re-establish the boundary mock so loadSectionCollapse never sees undefined.
    vi.mocked(appSettings.getLabSectionCollapse).mockResolvedValue({
      modellek: false,
      systemSkill: false,
      userPrompt: false,
    });
    resetStore();
  });

  it('should mutate store or external state when every button is clicked', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<LeftColumnContainer />);
    });

    const buttons = screen.getAllByRole('button');
    const deadButtons: string[] = [];

    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      if (btn.closest('[hidden]')) continue;

      const label = btn.textContent?.trim() ?? `(button #${i})`;

      const before = JSON.stringify(usePromptTesterStore.getState());

      try {
        await act(async () => {
          await user.click(btn);
        });
      } catch {
        continue;
      }

      const after = JSON.stringify(usePromptTesterStore.getState());

      if (before === after) {
        deadButtons.push(`"${label}" (index ${i})`);
      }
    }

    expect(
      deadButtons,
      `Dead handlers found — buttons with no observable effect: ${deadButtons.join(', ')}`
    ).toHaveLength(0);
  });
});
