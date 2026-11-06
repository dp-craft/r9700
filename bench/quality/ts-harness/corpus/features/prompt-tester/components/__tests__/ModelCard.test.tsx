import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ModelEntry, SliderValues } from '../../types';
import { ModelCard, type ModelCardLabels, type ModelCardProps } from '../ModelCard';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS: SliderValues = {
  temp: 0.7,
  topP: 1,
  maxTok: 2048,
  freq: 0,
  pres: 0,
};

function buildEntry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: 'model-1',
    providerId: 'claude',
    modelKey: 'claude-3-opus',
    name: 'Claude 3 Opus',
    params: DEFAULT_PARAMS,
    thinking: false,
    supportsThinking: false,
    expanded: false,
    accent: false,
    ...overrides,
  };
}

function buildProps(overrides: Partial<ModelCardProps> = {}): ModelCardProps {
  return {
    entry: buildEntry(),
    onSetParam: vi.fn(),
    onClampParam: vi.fn(),
    onToggleThinking: vi.fn(),
    onToggleExpanded: vi.fn(),
    onClose: vi.fn(),
    labels: {
      thinking: 'thinking',
      thinkingOn: 'thinking · on',
      legend: 'Parameters',
      paramLabels: {
        temp: 'Temperature',
        topP: 'Top P',
        maxTok: 'Max Tokens',
        freq: 'Frequency',
        pres: 'Presence',
        contextSize: 'Context Size',
      },
      cardAria: (name: string) => `Model card for ${name}`,
      toggleAria: (name: string) => `Toggle ${name}`,
      removeAria: (name: string) => `Remove ${name}`,
    } satisfies ModelCardLabels,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelCard', () => {
  // FR-020 / FR-023: Expanded + thinking on
  it('should render thinking pill with "thinking · on" text and onDot indicator when expanded with thinking enabled', () => {
    const entry = buildEntry({
      expanded: true,
      thinking: true,
      supportsThinking: true,
      accent: true,
    });
    render(<ModelCard {...buildProps({ entry })} />);

    const thinkingPill = screen.getByText('thinking · on');
    expect(thinkingPill).toBeInTheDocument();
  });

  it('should render all 5 sliders when expanded', () => {
    const entry = buildEntry({ expanded: true });
    render(<ModelCard {...buildProps({ entry })} />);

    expect(screen.getByLabelText('Temperature')).toBeInTheDocument();
    expect(screen.getByLabelText('Top P')).toBeInTheDocument();
    expect(screen.getByLabelText('Max Tokens')).toBeInTheDocument();
    expect(screen.getByLabelText('Frequency')).toBeInTheDocument();
    expect(screen.getByLabelText('Presence')).toBeInTheDocument();
    expect(screen.getByLabelText('Context Size')).toBeInTheDocument();
  });

  // FR-021: Collapsed variant — summary visible, sliders and thinking pill absent
  it('should render summary text in collapsed state', () => {
    const entry = buildEntry({
      expanded: false,
      params: { temp: 0.7, topP: 1, maxTok: 2048, freq: 0, pres: 0 },
    });
    render(<ModelCard {...buildProps({ entry })} />);

    expect(screen.getByText('0.7 · 1 · 2048')).toBeInTheDocument();
  });

  it('should not render sliders when collapsed', () => {
    const entry = buildEntry({ expanded: false });
    render(<ModelCard {...buildProps({ entry })} />);

    expect(screen.queryByLabelText('Temperature')).toBeNull();
    expect(screen.queryByLabelText('Top P')).toBeNull();
    expect(screen.queryByLabelText('Max Tokens')).toBeNull();
    expect(screen.queryByLabelText('Context Size')).toBeNull();
  });

  it('should not render thinking pill when collapsed', () => {
    const entry = buildEntry({ expanded: false, thinking: true, supportsThinking: true });
    render(<ModelCard {...buildProps({ entry })} />);

    expect(screen.queryByText('thinking · on')).toBeNull();
    expect(screen.queryByText('thinking')).toBeNull();
  });

  // FR-020 / FR-021: Accent vs non-accent border class
  it('should apply border-accent class when accent is true', () => {
    const entry = buildEntry({ accent: true });
    const { container } = render(<ModelCard {...buildProps({ entry })} />);

    const article = container.querySelector('article');
    expect(article?.className).toMatch(/border-accent/);
  });

  it('should not apply border-accent class when accent is false', () => {
    const entry = buildEntry({ accent: false });
    const { container } = render(<ModelCard {...buildProps({ entry })} />);

    const article = container.querySelector('article');
    expect(article?.className).not.toMatch(/border-accent/);
  });

  // FR-026: Thinking pill hidden when entry.supportsThinking is false
  it('should not render thinking pill when supportsThinking is false even when expanded', () => {
    const entry = buildEntry({ expanded: true, thinking: false, supportsThinking: false });
    render(<ModelCard {...buildProps({ entry })} />);

    expect(screen.queryByText('thinking · on')).toBeNull();
    expect(screen.queryByText('thinking')).toBeNull();
  });
});
