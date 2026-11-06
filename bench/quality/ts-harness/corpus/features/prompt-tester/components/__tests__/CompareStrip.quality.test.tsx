/**
 * L2 Renderer test — CompareStrip perplexity quality bands (ADR-018).
 *
 * FR: NEW:prompt-tester.perplexity-quality-indicator
 * Acceptance: data-quality attribute differs across good / average / bad bands.
 *
 * Thresholds (perplexityQuality.ts): good ≤ 30, average ≤ 80, bad > 80.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CompareCellVM, CompareMetricRow } from '../../types';
import { CompareStrip, type CompareStripProps } from '../CompareStrip';

// ---------------------------------------------------------------------------
// Builders (local — distinct from CompareStrip.test.tsx to keep files independent)
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
  values: [],
  isEstimate: true,
  ...overrides,
});

const buildProps = (overrides?: Partial<CompareStripProps>): CompareStripProps => ({
  mode: 'table',
  modeLabels: { diff: 'Diff', table: 'Table', both: 'Both' },
  title: 'Compare',
  diffPanes: [{ label: 'GPT-4o', text: 'Response A' }],
  metricRows: [],
  metricsHeaderLabel: 'Metric',
  metricColAriaLabel: (label: string) => `Model: ${label}`,
  estimateLabel: '(estimate)',
  cellCards: [buildCellCard('GPT-4o')],
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

describe('CompareStrip — perplexity quality bands', () => {
  it('should match snapshot for the good-band default render', () => {
    const { asFragment } = render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildPerplexityRow({ values: ['8.2'], qualities: ['good'] })],
        })}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('should carry data-quality="good" for a value in the good band (≤ 30)', () => {
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildPerplexityRow({ values: ['8.2'], qualities: ['good'] })],
        })}
      />
    );

    const pill = screen.getByTestId('perplexity-quality-good');
    expect(pill.getAttribute('data-quality')).toBe('good');
  });

  it('should carry data-quality="average" for a value in the average band (31–80)', () => {
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildPerplexityRow({ values: ['23.7'], qualities: ['average'] })],
        })}
      />
    );

    const pill = screen.getByTestId('perplexity-quality-average');
    expect(pill.getAttribute('data-quality')).toBe('average');
  });

  it('should carry data-quality="bad" for a value in the bad band (> 80)', () => {
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildPerplexityRow({ values: ['61.4'], qualities: ['bad'] })],
        })}
      />
    );

    const pill = screen.getByTestId('perplexity-quality-bad');
    expect(pill.getAttribute('data-quality')).toBe('bad');
  });

  it('should produce three distinct data-quality values across the three bands', () => {
    render(
      <CompareStrip
        {...buildProps({
          cellCards: [buildCellCard('A'), buildCellCard('B'), buildCellCard('C')],
          metricRows: [
            buildPerplexityRow({
              values: ['8.2', '23.7', '61.4'],
              qualities: ['good', 'average', 'bad'],
            }),
          ],
        })}
      />
    );

    const goodPill = screen.getByTestId('perplexity-quality-good');
    const avgPill = screen.getByTestId('perplexity-quality-average');
    const badPill = screen.getByTestId('perplexity-quality-bad');

    const qualityValues = [
      goodPill.getAttribute('data-quality'),
      avgPill.getAttribute('data-quality'),
      badPill.getAttribute('data-quality'),
    ];

    expect(new Set(qualityValues).size).toBe(3);
    expect(qualityValues).toEqual(['good', 'average', 'bad']);
  });
});
