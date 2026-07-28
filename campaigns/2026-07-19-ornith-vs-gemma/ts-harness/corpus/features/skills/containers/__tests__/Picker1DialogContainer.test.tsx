import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicSkillDTO } from '@/domain/entities';
import { useUIStore } from '@/stores/useUIStore';

import { useSkillStore } from '../../stores/useSkillStore';
import { Picker1DialogContainer } from '../Picker1DialogContainer';

// -- Mocks --

const hoisted = vi.hoisted(() => ({
  addSystemPromptToActiveRun: vi.fn(),
  pickerHistoryRef: {
    current: [] as readonly { runId: string; prompt: string; recordedAt: number }[],
  },
}));

const addSystemPromptToActiveRun = hoisted.addSystemPromptToActiveRun;

vi.mock('@/features/prompt-tester', () => {
  const storeFn = (selector?: (s: { pickerHistory: readonly unknown[] }) => unknown) => {
    const state = { pickerHistory: hoisted.pickerHistoryRef.current };
    return selector ? selector(state) : state;
  };
  (storeFn as unknown as { getState: () => unknown }).getState = () => ({
    addSystemPromptToActiveRun: hoisted.addSystemPromptToActiveRun,
  });
  return { usePromptTesterStore: storeFn };
});

// -- Builders --

const TS = 1_700_000_000_000;

const buildSkill = (overrides?: Partial<AtomicSkillDTO>): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'Grammar',
  prompt: 'Check grammar carefully',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

// -- Setup --

const initialSkillState = useSkillStore.getState();
const initialUIState = useUIStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.pickerHistoryRef.current = [];
  useSkillStore.setState(initialSkillState, true);
  useUIStore.setState(initialUIState, true);
});

const renderOpen = (skills: readonly AtomicSkillDTO[] = []) => {
  useSkillStore.setState({ skills });
  const onOpenChange = vi.fn();
  const utils = render(<Picker1DialogContainer open={true} onOpenChange={onOpenChange} />);
  return { onOpenChange, ...utils };
};

const flush = () => act(async () => undefined);

// -- Tests --

describe('Picker1DialogContainer', () => {
  it('should render Picker1Dialog when open=true', async () => {
    renderOpen([buildSkill()]);
    await flush();
    expect(screen.getByTestId('picker1-dialog')).toBeInTheDocument();
  });

  it('should not render dialog content when open=false', () => {
    render(<Picker1DialogContainer open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId('picker1-dialog')).not.toBeInTheDocument();
  });

  it('should render history items provided by usePromptTesterStore.pickerHistory (FR-042)', async () => {
    hoisted.pickerHistoryRef.current = [
      { runId: 'r1', prompt: 'Custom history prompt', recordedAt: TS },
    ];
    renderOpen([]);
    await flush();

    expect(screen.getByText('Custom history prompt')).toBeInTheDocument();
  });

  it('should call addSystemPromptToActiveRun with skill payload and close on skill activate (FR-045)', async () => {
    const user = userEvent.setup();
    const skill = buildSkill({ id: 'sk-1', name: 'Brevity', prompt: 'Be concise' });
    const { onOpenChange } = renderOpen([skill]);
    await flush();

    await user.click(screen.getByText('Brevity'));

    expect(addSystemPromptToActiveRun).toHaveBeenCalledWith({
      kind: 'skill',
      skillId: 'sk-1',
      name: 'Brevity',
      prompt: 'Be concise',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should call addSystemPromptToActiveRun with blank payload and close when New blank clicked', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderOpen([]);
    await flush();

    await user.click(screen.getByTestId('picker1-new-blank'));

    expect(addSystemPromptToActiveRun).toHaveBeenCalledWith({ kind: 'blank' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should hide history rows when activeFilter=skills', async () => {
    const user = userEvent.setup();
    hoisted.pickerHistoryRef.current = [
      { runId: 'r1', prompt: 'Custom history prompt', recordedAt: TS },
    ];
    renderOpen([buildSkill({ id: 's1', name: 'Grammar', prompt: 'Check grammar' })]);
    await flush();

    expect(screen.getByText('Custom history prompt')).toBeInTheDocument();

    await user.click(screen.getByTestId('picker1-filter-skills'));

    expect(screen.queryByText('Custom history prompt')).not.toBeInTheDocument();
    expect(screen.getByText('Grammar')).toBeInTheDocument();
  });

  it('should show empty skills list when activeFilter=pinned (no skills are pinned)', async () => {
    const user = userEvent.setup();
    renderOpen([buildSkill({ id: 's1', name: 'Grammar', prompt: 'Check grammar' })]);
    await flush();

    await user.click(screen.getByTestId('picker1-filter-pinned'));

    expect(screen.queryByText('Grammar')).not.toBeInTheDocument();
  });

  it('should text-filter skills by query (case-insensitive name + prompt)', async () => {
    const user = userEvent.setup();
    renderOpen([
      buildSkill({ id: 's1', name: 'Grammar', prompt: 'Check grammar' }),
      buildSkill({ id: 's2', name: 'Style', prompt: 'Improve readability' }),
    ]);
    await flush();

    const dialog = screen.getByTestId('picker1-dialog');
    const input = within(dialog).getByPlaceholderText(/search/i);
    await user.type(input, 'gram');

    expect(screen.getByText('Grammar')).toBeInTheDocument();
    expect(screen.queryByText('Style')).not.toBeInTheDocument();
  });

  it('should close when useUIStore.workspace changes (FR-047)', async () => {
    const { onOpenChange } = renderOpen([buildSkill()]);
    await flush();

    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('should not mutate skill store when picker closes without explicit pin toggle (FR-047)', async () => {
    const { onOpenChange } = renderOpen([buildSkill()]);
    await flush();

    const setStateSpy = vi.spyOn(useSkillStore, 'setState');

    act(() => {
      useUIStore.setState({ workspace: 'prompt-lab' });
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // No skill-store mutation triggered by close itself
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(addSystemPromptToActiveRun).not.toHaveBeenCalled();

    setStateSpy.mockRestore();
  });
});
