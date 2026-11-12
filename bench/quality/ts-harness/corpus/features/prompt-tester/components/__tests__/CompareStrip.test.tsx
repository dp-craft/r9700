/**
 * L2 Renderer test — CompareStrip (ADR-018).
 *
 * Covers (mode: green — implementation already landed):
 *   T014 — perplexity-cell-calculating spinner (ANALYZING_SENTINEL in values)
 *   T018 — perplexity quality pill (data-testid perplexity-quality-{band}, data-quality, title/aria-label)
 *          mutual exclusivity: analyzing cell → spinner only; banded cell → pill only
 *   T020 — field-info-{metricKey} button per metric that has a tooltip entry
 *   T066 — compare-strip-empty-state when isEmpty=true; absent when isEmpty=false
 *   T067 — performance-metrics-table testid in table mode
 *
 * Shape (ADR-018 L2): 2 file-based snapshots + 5 behavioral blocks = 7 total.
 * FORBIDDEN: toHaveClass, structure-count, "renders without crashing".
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompareCellVM, CompareMetricRow } from '../../types';
import { ANALYZING_SENTINEL } from '../../utils/buildCompareRows';
import { CompareStrip, type CompareStripProps } from '../CompareStrip';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildModelParams = (): CompareCellVM['modelParams'] => ({
  params: {
    temp: 0.7,
    topP: 1,
    maxTok: 512,
    freq: 0,
    pres: 0,
  },
  supportsThinking: false,
  thinking: false,
  labels: {
    temp: 'Temperature',
    topP: 'Top P',
    maxTok: 'Max tokens',
    freq: 'Frequency penalty',
    pres: 'Presence penalty',
    contextSize: 'Context size',
    thinking: 'Thinking',
    thinkingBudget: 'Thinking budget',
  },
});

const buildCellCard = (label: string): CompareCellVM => ({
  label,
  modelParams: buildModelParams(),
});

const buildMetricRow = (overrides?: Partial<CompareMetricRow>): CompareMetricRow => ({
  metricKey: 'readability',
  label: 'Readability',
  values: ['7.4', '9.1'],
  isEstimate: false,
  ...overrides,
});

const buildProps = (overrides?: Partial<CompareStripProps>): CompareStripProps => ({
  mode: 'table',
  modeLabels: { diff: 'Diff', table: 'Table', both: 'Both' },
  title: 'Compare',
  diffPanes: [
    { label: 'GPT-4o', text: 'Response A' },
    { label: 'Claude', text: 'Response B' },
  ],
  metricRows: [buildMetricRow()],
  metricsHeaderLabel: 'Metric',
  metricColAriaLabel: (label: string) => `Model: ${label}`,
  estimateLabel: '(estimate)',
  cellCards: [buildCellCard('GPT-4o'), buildCellCard('Claude')],
  metricTooltips: {},
  fieldInfoLabel: (metricLabel: string) => `Explain ${metricLabel}`,
  calculatingLabel: 'calculating…',
  qualityLabels: { good: 'good', average: 'average', bad: 'bad' },
  isEmpty: false,
  emptyStateLabel: 'Select 2 or more cells to compare',
  onModeChange: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompareStrip', () => {
  // 1. Default snapshot — table mode, non-empty, no quality bands, no tooltips.
  it('should match snapshot with default props (table mode, two cells, no quality)', () => {
    const { asFragment } = render(<CompareStrip {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  // 2. Empty-state branch (T066) — isEmpty=true renders placeholder, not metrics table.
  it('should match snapshot when isEmpty is true (empty-state placeholder)', () => {
    const { asFragment } = render(<CompareStrip {...buildProps({ isEmpty: true })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  // 3. Mutual exclusivity both directions (T014 + T018):
  //    analyzing → spinner present, quality pill absent;
  //    settled band → pill present, spinner absent.
  it('should enforce spinner↔quality-pill mutual exclusion in both directions', () => {
    const analyzingRow = buildMetricRow({
      metricKey: 'perplexity-true',
      label: 'Perplexity',
      values: [ANALYZING_SENTINEL, '9.0'],
      isEstimate: true,
      qualities: [undefined, undefined],
    });
    const { rerender } = render(<CompareStrip {...buildProps({ metricRows: [analyzingRow] })} />);

    expect(screen.getByTestId('perplexity-cell-calculating')).toBeTruthy();
    expect(screen.queryByTestId('perplexity-quality-good')).toBeNull();
    expect(screen.queryByTestId('perplexity-quality-bad')).toBeNull();

    const settledRow = buildMetricRow({
      metricKey: 'perplexity-true',
      label: 'Perplexity',
      values: ['61.4', '8.2'],
      isEstimate: true,
      qualities: ['bad', 'good'],
    });
    rerender(<CompareStrip {...buildProps({ metricRows: [settledRow] })} />);

    expect(screen.getByTestId('perplexity-quality-bad')).toBeTruthy();
    expect(screen.getByTestId('perplexity-quality-good')).toBeTruthy();
    expect(screen.queryByTestId('perplexity-cell-calculating')).toBeNull();
  });

  // 4. Quality pill data-quality attribute and non-color cue (T018 acceptance criteria).
  it('should set data-quality attribute and title/aria-label on quality pill', () => {
    const perplexityRow = buildMetricRow({
      metricKey: 'perplexity-true',
      label: 'Perplexity',
      values: ['23.7'],
      isEstimate: true,
      qualities: ['average'],
    });
    render(
      <CompareStrip
        {...buildProps({
          cellCards: [buildCellCard('GPT-4o')],
          metricRows: [perplexityRow],
          qualityLabels: { good: 'good', average: 'average', bad: 'bad' },
        })}
      />
    );

    const pill = screen.getByTestId('perplexity-quality-average');
    expect(pill.getAttribute('data-quality')).toBe('average');
    expect(pill.getAttribute('title')).toBe('average');
    expect(pill.getAttribute('aria-label')).toBe('average');
  });

  // 5. Empty-state↔metrics-table exclusivity (T066 / T067).
  it('should show empty-state XOR metrics-table depending on isEmpty', () => {
    const { rerender } = render(<CompareStrip {...buildProps({ isEmpty: true })} />);

    expect(screen.getByTestId('compare-strip-empty-state')).toBeTruthy();
    expect(screen.queryByTestId('performance-metrics-table')).toBeNull();

    rerender(<CompareStrip {...buildProps({ isEmpty: false })} />);

    expect(screen.getByTestId('performance-metrics-table')).toBeTruthy();
    expect(screen.queryByTestId('compare-strip-empty-state')).toBeNull();
  });

  // 6. Field-info button presence when tooltip entry exists (T020).
  it('should render field-info button for each metric that has a tooltip entry', () => {
    const rowWithTooltip = buildMetricRow({ metricKey: 'readability', label: 'Readability' });
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [rowWithTooltip],
          metricTooltips: { readability: 'Higher scores indicate easier-to-read text.' },
        })}
      />
    );

    expect(screen.getByTestId('field-info-readability')).toBeTruthy();
  });

  // 7. Callback (onModeChange) — parametrized over all three mode buttons.
  it.each([
    ['diff', 'Diff'],
    ['table', 'Table'],
    ['both', 'Both'],
  ] as const)('should call onModeChange with "%s" when the %s button is clicked', async (mode, label) => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<CompareStrip {...buildProps({ onModeChange })} />);

    await user.click(screen.getByRole('button', { name: label }));

    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith(mode);
  });
});
