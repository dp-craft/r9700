// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import type { CellResult, RunTab } from '../../types';
import { CompareStripContainer } from '../CompareStripContainer';

const buildCell = (id: string, output: string): CellResult => ({
  id,
  modelId: `model-${id}`,
  promptId: 'prompt-1',
  userPromptHash: 'hash-1',
  output,
  latencyMs: 1000,
  tokens: 100,
  cost: 0.001,
  ratings: { accuracy: 0, style: 0, tone: 0, length: 0, readability: 0 },
  cached: false,
  status: 'done',
  resolvedModel: {
    name: `Model ${id}`,
    providerId: 'chatgpt',
    modelKey: `model-${id}`,
    params: { temp: 0.7, topP: 1.0, maxTok: 2048, freq: 0, pres: 0 },
    thinking: false,
  },
});

const buildRun = (overrides: Partial<RunTab>): RunTab => ({
  id: 1,
  label: 'Run 1',
  createdAt: 1000,
  configSnapshot: { models: [], prompts: [], userPrompt: '' },
  cells: [],
  selectedCellIds: [],
  compareMode: 'diff',
  sort: 'mean',
  group: 'model',
  gridCols: 3,
  viewMode: 'list',
  ...overrides,
});

const seedStore = (
  selectedCellIds: readonly string[],
  cells: readonly CellResult[] = [],
  compareMode: RunTab['compareMode'] = 'diff'
): void => {
  usePromptTesterStore.setState({
    runs: [buildRun({ selectedCellIds, cells, compareMode })],
    activeRunId: 1,
  });
};

describe('CompareStripContainer — L3 smoke', () => {
  beforeEach(() => {
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should render empty-state placeholder when no cells are selected', () => {
    seedStore([]);
    render(<CompareStripContainer />);
    expect(screen.getByTestId('compare-strip-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('compare-strip-scroll')).not.toBeInTheDocument();
  });

  it('should render empty-state placeholder when only 1 cell is selected', () => {
    const cells = [buildCell('c1', 'Hello')];
    seedStore(['c1'], cells);
    render(<CompareStripContainer />);
    expect(screen.getByTestId('compare-strip-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('compare-strip-scroll')).not.toBeInTheDocument();
  });

  it('should render CompareStrip when 2 cells are selected', () => {
    const cells = [buildCell('c1', 'Hello'), buildCell('c2', 'World')];
    seedStore(['c1', 'c2'], cells);
    const { container } = render(<CompareStripContainer />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByRole('region', { name: 'lab.compare.title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lab.compare.diff' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('should render CompareStrip when 3 cells are selected', () => {
    const cells = [buildCell('c1', 'Alpha'), buildCell('c2', 'Beta'), buildCell('c3', 'Gamma')];
    seedStore(['c1', 'c2', 'c3'], cells);
    render(<CompareStripContainer />);
    expect(screen.getByRole('region', { name: 'lab.compare.title' })).toBeInTheDocument();
  });

  it('should render the metrics table in table mode', () => {
    const cells = [buildCell('c1', 'Hello'), buildCell('c2', 'World')];
    seedStore(['c1', 'c2'], cells, 'table');
    render(<CompareStripContainer />);
    expect(screen.getByTestId('performance-metrics-table')).toBeInTheDocument();
  });

  it('should pass compareMode from store to CompareStrip', () => {
    const cells = [buildCell('c1', 'Hello'), buildCell('c2', 'World')];
    seedStore(['c1', 'c2'], cells, 'table');
    render(<CompareStripContainer />);
    // The rendered strip should reflect the 'table' mode from the store
    // The active Table button has aria-pressed="true"
    const tableBtn = screen.getByRole('button', { name: 'lab.compare.table' });
    expect(tableBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('should invoke store action when mode change button is clicked (dead-handler walk)', async () => {
    const cells = [buildCell('c1', 'Hello'), buildCell('c2', 'World')];
    seedStore(['c1', 'c2'], cells, 'diff');
    const user = userEvent.setup();
    render(<CompareStripContainer />);

    const buttons = screen.queryAllByRole('button');
    for (const btn of buttons) {
      const name = btn.getAttribute('aria-label') ?? btn.textContent?.trim() ?? '(unnamed)';
      // Skip already-active button — clicking it is a no-op by design
      const isActive = btn.getAttribute('aria-pressed') === 'true';
      if (isActive) continue;
      const stateBefore = JSON.stringify(usePromptTesterStore.getState());
      await user.click(btn);
      const stateAfter = JSON.stringify(usePromptTesterStore.getState());
      expect(
        stateAfter,
        `Dead handler detected — button "${name}" did not change store state`
      ).not.toBe(stateBefore);
    }
  });
});
