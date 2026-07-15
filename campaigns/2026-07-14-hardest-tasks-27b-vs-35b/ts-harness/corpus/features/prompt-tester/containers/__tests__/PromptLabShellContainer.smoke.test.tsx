// Boundary mocks — declared before imports (Vitest hoisting)

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

vi.mock('@/services/llm/stream', () => ({ streamChat: vi.fn() }));

// Stub shell hooks/components that pull in unrelated deps
vi.mock('@/shell/hooks/useMFRailItems', () => ({
  useMFRailItems: () => ({
    items: [{ id: 'lab-skills', panelKey: 'skills', labelKey: 'Skills', icon: null }],
    activePanelKey: 'tester',
    onSelect: vi.fn(),
  }),
}));

vi.mock('@/shell/components/MFRail', () => ({
  MFRail: ({
    items,
    onPanelChange,
  }: {
    items: readonly { id: string; panelKey: string; labelKey: string }[];
    activePanelKey: string;
    onPanelChange: (key: string) => void;
  }) => (
    <nav>
      {items.map(item => (
        <button key={item.id} type="button" onClick={() => onPanelChange(item.panelKey)}>
          {item.labelKey}
        </button>
      ))}
    </nav>
  ),
}));

// Stub heavy inner containers to isolate the shell container
vi.mock('../LeftColumnContainer', () => ({
  LeftColumnContainer: () => <div data-testid="left-column-content" />,
}));

vi.mock('../RunTabsContainer', () => ({
  RunTabsContainer: () => <div data-testid="run-tabs" />,
}));

vi.mock('../DetailPanelContainer', () => ({
  DetailPanelContainer: () => null,
}));

vi.mock('../ResultsGridContainer', () => ({
  ResultsGridContainer: () => <div data-testid="results-grid" />,
}));

vi.mock('../RightColumnContainer', () => ({
  RightColumnContainer: () => (
    <div>
      <div data-testid="results-body-region" />
      <div data-testid="strip-resize-handle" />
    </div>
  ),
}));

vi.mock('../RunHistoryPanelHost', () => ({
  RunHistoryPanelHost: () => <div data-testid="run-history-panel" />,
}));

vi.mock('../PromptHistoryPanelHost', () => ({
  PromptHistoryPanelHost: () => <div data-testid="prompt-history-panel" />,
}));

vi.mock('@/shell/containers/SkillsPanelContainer', () => ({
  SkillsPanelContainer: () => <div data-testid="skills-panel-sentinel" />,
}));

import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '@/stores/useUIStore';
import { ariaTree } from '@/test/serializers/aria-tree';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { PromptLabShellContainer } from '../PromptLabShellContainer';

// ---------------------------------------------------------------------------
// Store reset
// ---------------------------------------------------------------------------

const resetStore = (): void => {
  usePromptTesterStore.setState({
    mode: 'simple',
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
  useUIStore.setState({ labPanel: 'tester' });
};

// ---------------------------------------------------------------------------
// Smoke tests — FR-003, FR-004, FR-011
// ---------------------------------------------------------------------------

describe('PromptLabShellContainer — smoke', () => {
  beforeEach(() => {
    resetStore();
  });

  // -------------------------------------------------------------------------
  // ariaTree snapshot — navigation rail present, tester content rendered
  // -------------------------------------------------------------------------

  it('should match ariaTree snapshot with rail and tester content in default state', async () => {
    const { container } = await act(async () => render(<PromptLabShellContainer />));

    expect(ariaTree(container)).toMatchInlineSnapshot(`
      "- complementary "Navigation rail"
        - navigation
          - button "Skills"
      - main
        - banner
        - complementary "lab.layout.leftColumnAria"
        - region "lab.layout.rightColumnAria""
    `);
  });

  // -------------------------------------------------------------------------
  // T007: ResultsGridContainer renders in middle column below RunTabsContainer
  // -------------------------------------------------------------------------

  it('should render layout-header above right-column and right-column hosts RightColumnContainer content', async () => {
    const { container } = await act(async () => render(<PromptLabShellContainer />));

    const header = container.querySelector('[data-testid="layout-header"]');
    const rightColumn = container.querySelector('[data-testid="right-column"]');

    expect(header).not.toBeNull();
    expect(rightColumn).not.toBeNull();

    // header must appear before right-column in DOM order
    expect(
      header!.compareDocumentPosition(rightColumn!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // RightColumnContainer content lives inside the right-column section
    expect(rightColumn!.querySelector('[data-testid="results-body-region"]')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // labPanel routing — tester panel renders lab content
  // -------------------------------------------------------------------------

  it('should render tester content when labPanel is tester', async () => {
    useUIStore.setState({ labPanel: 'tester' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(
      screen.getByRole('complementary', { name: 'lab.layout.leftColumnAria' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('left-column-content')).toBeInTheDocument();
    expect(screen.getByTestId('run-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('run-history-panel')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // labPanel routing — run-history panel renders RunHistoryPanelHost
  // -------------------------------------------------------------------------

  it('should render RunHistoryPanelHost when labPanel is run-history', async () => {
    useUIStore.setState({ labPanel: 'run-history' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(screen.getByTestId('run-history-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('left-column')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // labPanel routing — prompt-history panel renders PromptHistoryPanelHost
  // -------------------------------------------------------------------------

  it('should render PromptHistoryPanelHost when labPanel is prompt-history', async () => {
    useUIStore.setState({ labPanel: 'prompt-history' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(screen.getByTestId('prompt-history-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('left-column')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // labPanel routing — skills panel renders SkillsPanelContainer
  // -------------------------------------------------------------------------

  it('should render SkillsPanelContainer when labPanel is skills', async () => {
    useUIStore.setState({ labPanel: 'skills' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(screen.getByTestId('skills-panel-sentinel')).toBeInTheDocument();
    expect(screen.queryByTestId('left-column')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // NEW:layout-header-tabs — MfLayoutSkeleton header housing RunTabsContainer
  // NEW:left-right-column-structure — two distinct labelled column regions
  // NEW:app-container-fit — RightColumnContainer mounted as rightColumnSlot
  // -------------------------------------------------------------------------

  it('should render layout-header housing RunTabsContainer when labPanel is tester', async () => {
    useUIStore.setState({ labPanel: 'tester' });
    await act(async () => render(<PromptLabShellContainer />));

    const header = screen.getByTestId('layout-header');
    expect(header).toBeInTheDocument();
    expect(header.querySelector('[data-testid="run-tabs"]')).not.toBeNull();
  });

  it('should render two distinct labelled column regions when labPanel is tester', async () => {
    useUIStore.setState({ labPanel: 'tester' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(
      screen.getByRole('complementary', { name: 'lab.layout.leftColumnAria' })
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'lab.layout.rightColumnAria' })).toBeInTheDocument();
  });

  it('should mount RightColumnContainer as rightColumnSlot with results-body-region and strip-resize-handle', async () => {
    useUIStore.setState({ labPanel: 'tester' });
    await act(async () => render(<PromptLabShellContainer />));

    expect(screen.getByTestId('results-body-region')).toBeInTheDocument();
    expect(screen.getByTestId('strip-resize-handle')).toBeInTheDocument();
  });
});
