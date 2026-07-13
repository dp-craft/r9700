import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ParallelismMode } from '@/domain/run-controls';

import {
  type LabFlagViewModel,
  PromptTesterSettingsSection,
  type PromptTesterSettingsSectionProps
} from '../PromptTesterSettingsSection';

const LABELS = {
  heading: 'Concurrency',
  help: 'Run mode',
  sameModel: 'Same model parallel',
  everything: 'Everything parallel',
} as const;

const EMPTY_FLAGS: readonly LabFlagViewModel[] = [];

const SAMPLE_FLAGS: readonly LabFlagViewModel[] = [
  {
    key: 'lab-perplexity-enabled',
    name: 'Perplexity Lab',
    description: 'Enable Perplexity',
    enabled: false,
  },
  {
    key: 'lab-text-analysis-enabled',
    name: 'Text Analysis Lab',
    description: 'Enable text analysis',
    enabled: true,
  },
];

function buildProps(
  overrides: Partial<PromptTesterSettingsSectionProps> = {}
): PromptTesterSettingsSectionProps {
  return {
    parallelismMode: 'same-model' as ParallelismMode,
    onModeChange: vi.fn(),
    flags: EMPTY_FLAGS,
    onToggleFlag: vi.fn(),
    labels: LABELS,
    ...overrides,
  };
}

describe('PromptTesterSettingsSection', () => {
  it('should render exactly one mode select with localized heading and help', () => {
    render(<PromptTesterSettingsSection {...buildProps()} />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText(LABELS.heading)).toBeInTheDocument();
    expect(screen.getByText(LABELS.help)).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('should render one switch per flag entry with matching accessible name', () => {
    render(<PromptTesterSettingsSection {...buildProps({ flags: SAMPLE_FLAGS })} />);

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(SAMPLE_FLAGS.length);
    expect(screen.getByRole('switch', { name: 'Perplexity Lab' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Text Analysis Lab' })).toBeInTheDocument();
  });

  it('should call onToggleFlag with the flag key when a switch is clicked', async () => {
    const user = userEvent.setup();
    const onToggleFlag = vi.fn();

    render(<PromptTesterSettingsSection {...buildProps({ flags: SAMPLE_FLAGS, onToggleFlag })} />);

    await user.click(screen.getByRole('switch', { name: 'Perplexity Lab' }));

    expect(onToggleFlag).toHaveBeenCalledWith('lab-perplexity-enabled');
  });

  it('should reflect same-model as active when parallelismMode is same-model', () => {
    render(<PromptTesterSettingsSection {...buildProps({ parallelismMode: 'same-model' })} />);

    expect(screen.getByRole('combobox')).toHaveTextContent(LABELS.sameModel);
  });

  it('should reflect everything as active when parallelismMode is everything', () => {
    render(<PromptTesterSettingsSection {...buildProps({ parallelismMode: 'everything' })} />);

    expect(screen.getByRole('combobox')).toHaveTextContent(LABELS.everything);
  });

  it('should call onModeChange with everything when that option is selected', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <PromptTesterSettingsSection
        {...buildProps({ parallelismMode: 'same-model', onModeChange })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    const option = screen.getAllByRole('option').find(o => o.textContent === LABELS.everything);
    expect(option).toBeDefined();
    await user.click(option!);

    expect(onModeChange).toHaveBeenCalledWith('everything');
  });

  it('should call onModeChange with same-model when that option is selected', async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <PromptTesterSettingsSection
        {...buildProps({ parallelismMode: 'everything', onModeChange })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    const option = screen.getAllByRole('option').find(o => o.textContent === LABELS.sameModel);
    expect(option).toBeDefined();
    await user.click(option!);

    expect(onModeChange).toHaveBeenCalledWith('same-model');
  });

  it('should render evalModelSlot content when the prop is provided', () => {
    render(
      <PromptTesterSettingsSection
        {...buildProps({ evalModelSlot: <div data-testid="eval-slot-probe" /> })}
      />
    );

    expect(screen.getByTestId('eval-slot-probe')).toBeInTheDocument();
  });

  it('should render flags and toggles without error when evalModelSlot is omitted', () => {
    render(<PromptTesterSettingsSection {...buildProps({ flags: SAMPLE_FLAGS })} />);

    expect(screen.queryByTestId('eval-slot-probe')).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(SAMPLE_FLAGS.length);
  });
});
