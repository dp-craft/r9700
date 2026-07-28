/**
 * L2 Renderer test — CompareStrip perplexity spinner (ADR-018, T015).
 *
 * Acceptance criteria (NEW:prompt-tester.perplexity-progress-spinner):
 *   positive: When analyzingCellId === cell, the perplexity field shows a
 *             spinner (data-testid="perplexity-cell-calculating") in place of
 *             the "—" placeholder.
 *   negative: When the cell is not analyzing and has no perplexity value,
 *             "—" appears with no spinner.
 *   settled:  When analysis has completed (numeric value present), the
 *             numeric value renders and the spinner is absent.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CompareCellVM, CompareMetricRow } from '../../types';
import { ANALYZING_SENTINEL } from '../../utils/buildCompareRows';
import { CompareStrip, type CompareStripProps } from '../CompareStrip';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildModelParams = (): CompareCellVM['modelParams'] => ({
  params: { temp: 0.7, topP: 1, maxTok: 512, freq: 0, pres: 0 },
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

const buildPerplexityRow = (overrides: Partial<CompareMetricRow>): CompareMetricRow => ({
  metricKey: 'perplexity-true',
  label: 'Perplexity',
  values: ['—'],
  isEstimate: true,
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
  metricRows: [],
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

describe('CompareStrip — perplexity progress spinner', () => {
  it('should match snapshot for the spinner-active state', () => {
    const { asFragment } = render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildPerplexityRow({ values: [ANALYZING_SENTINEL, '—'] })],
        })}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('should show the calculating spinner when the value is the ANALYZING_SENTINEL', () => {
    const analyzingRow = buildPerplexityRow({
      values: [ANALYZING_SENTINEL, '—'],
    });

    render(<CompareStrip {...buildProps({ metricRows: [analyzingRow] })} />);

    expect(screen.getByTestId('perplexity-cell-calculating')).toBeTruthy();
  });

  it('should not show the calculating spinner when the cell value is the fallback dash', () => {
    const idleRow = buildPerplexityRow({ values: ['—', '—'] });

    render(<CompareStrip {...buildProps({ metricRows: [idleRow] })} />);

    expect(screen.queryByTestId('perplexity-cell-calculating')).toBeNull();
  });

  it('should not show the calculating spinner when the cell has a settled numeric value', () => {
    const settledRow = buildPerplexityRow({
      values: ['12.4', '9.0'],
      qualities: ['good', 'good'],
    });

    render(<CompareStrip {...buildProps({ metricRows: [settledRow] })} />);

    expect(screen.queryByTestId('perplexity-cell-calculating')).toBeNull();
    // Both cells settled — each carries a good-band pill
    const goodPills = screen.getAllByTestId('perplexity-quality-good');
    expect(goodPills[0]).toBeInTheDocument();
    expect(goodPills[1]).toBeInTheDocument();
  });

  it('should display the calculatingLabel text inside the spinner element', () => {
    const analyzingRow = buildPerplexityRow({ values: [ANALYZING_SENTINEL, '—'] });

    render(
      <CompareStrip
        {...buildProps({
          metricRows: [analyzingRow],
          calculatingLabel: 'calculating…',
        })}
      />
    );

    const spinner = screen.getByTestId('perplexity-cell-calculating');
    expect(spinner.textContent).toContain('calculating…');
  });
});
