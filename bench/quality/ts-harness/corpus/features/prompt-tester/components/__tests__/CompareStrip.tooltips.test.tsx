/**
 * L2 Renderer test — CompareStrip tooltip reveal (ADR-018).
 *
 * Covers (mode: green — implementation already shipped):
 *   NEW:prompt-tester.diff-view-field-tooltips
 *   Hovering or focusing a field info icon reveals the tooltip text.
 *
 * Radix Tooltip setup: TooltipProvider in CompareStrip sets delayDuration=0 (shadcn default),
 * so hover is instant; no fake-timers needed. TooltipContent uses a Portal — findByRole scans
 * the document body automatically.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CompareCellVM, CompareMetricRow } from '../../types';
import { CompareStrip, type CompareStripProps } from '../CompareStrip';

// ---------------------------------------------------------------------------
// Builders (minimal — tooltip surface only)
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
  onModeChange: () => undefined,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tooltip reveal tests
// ---------------------------------------------------------------------------

describe('CompareStrip — field info tooltips', () => {
  it('should match snapshot for the default tooltip surface render', () => {
    const { asFragment } = render(<CompareStrip {...buildProps()} />);
    expect(asFragment()).toMatchSnapshot();
  });

  it('should reveal tooltip text when the info icon is hovered', async () => {
    const user = userEvent.setup();
    const tooltipText = 'Higher scores indicate easier-to-read text. Lower is harder.';
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildMetricRow({ metricKey: 'readability', label: 'Readability' })],
          metricTooltips: { readability: tooltipText },
        })}
      />
    );

    const infoButton = screen.getByTestId('field-info-readability');
    await user.hover(infoButton);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain(tooltipText);
  });

  it('should reveal tooltip text when the info icon receives keyboard focus', async () => {
    const user = userEvent.setup();
    const tooltipText = 'How "surprised" the model was by its own output. Lower is better.';
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [
            buildMetricRow({
              metricKey: 'perplexity-true',
              label: 'Perplexity',
              values: ['8.2', '31.5'],
              isEstimate: true,
            }),
          ],
          metricTooltips: { 'perplexity-true': tooltipText },
        })}
      />
    );

    const infoButton = screen.getByTestId('field-info-perplexity-true');
    await user.tab();
    infoButton.focus();

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain(tooltipText);
  });

  it('should not render an info icon when no tooltip entry exists for a metric', () => {
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [buildMetricRow({ metricKey: 'wordcount', label: 'Word count' })],
          metricTooltips: {},
        })}
      />
    );

    expect(screen.queryByTestId('field-info-wordcount')).toBeNull();
  });

  it('should render separate info icons for each metric that has a tooltip entry', async () => {
    const user = userEvent.setup();
    render(
      <CompareStrip
        {...buildProps({
          metricRows: [
            buildMetricRow({
              metricKey: 'readability',
              label: 'Readability',
              values: ['7.4', '9.1'],
            }),
            buildMetricRow({
              metricKey: 'wordcount',
              label: 'Word count',
              values: ['142', '158'],
            }),
            buildMetricRow({
              metricKey: 'sentiment',
              label: 'Sentiment',
              values: ['0.8', '0.6'],
            }),
          ],
          metricTooltips: {
            readability: 'Readability tooltip',
            wordcount: 'Word count tooltip',
          },
        })}
      />
    );

    expect(screen.getByTestId('field-info-readability')).toBeTruthy();
    expect(screen.getByTestId('field-info-wordcount')).toBeTruthy();
    expect(screen.queryByTestId('field-info-sentiment')).toBeNull();

    await user.hover(screen.getByTestId('field-info-wordcount'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('Word count tooltip');
  });
});
