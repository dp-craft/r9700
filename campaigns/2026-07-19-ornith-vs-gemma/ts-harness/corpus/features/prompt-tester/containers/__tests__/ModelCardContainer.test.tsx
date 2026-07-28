// Integration tests — real store + real components (no mocks of internal code)
// Boundary mocks declared before imports (Vitest hoisting)

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
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

vi.mock('@/features/settings', () => ({
  buildModelMetadataRows: vi.fn().mockReturnValue([]),
  ModelMetadataPopover: ({
    supportsThinking,
    thinkingEnabled,
    onThinkingToggle,
  }: {
    supportsThinking?: boolean;
    thinkingEnabled?: boolean;
    onThinkingToggle?: () => void;
  }) =>
    supportsThinking ? (
      <button
        type="button"
        role="switch"
        data-testid="thinking-mode-toggle"
        aria-checked={thinkingEnabled}
        onClick={onThinkingToggle}
      />
    ) : null,
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

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { ModelCardContainer } from '../ModelCardContainer';

// ---------------------------------------------------------------------------
// Store reset helper
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

const seedModel = (overrides: {
  readonly supportsThinking?: boolean;
  readonly expanded?: boolean;
}): string => {
  act(() => {
    usePromptTesterStore.getState().addModel({
      providerId: 'claude',
      modelKey: 'claude-3-opus',
      name: 'Claude 3 Opus',
      supportsThinking: overrides.supportsThinking ?? false,
    });
  });
  const model = usePromptTesterStore.getState().models[0];
  if (!model) throw new Error('seedModel: model was not added');
  if (overrides.expanded) {
    act(() => {
      usePromptTesterStore.getState().toggleModelExpanded(model.id);
    });
  }
  return model.id;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelCardContainer', () => {
  beforeEach(() => {
    resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // FR-024 — Slider drag updates store value live + displays formatted value
  // =========================================================================

  it('should update store temp param when slider onValueChange fires', () => {
    // addModel sets expanded:true for the first model — sliders are visible
    const modelId = seedModel({});

    render(<ModelCardContainer modelId={modelId} />);

    // Radix Slider Root receives onValueChange; container wires it to setModelParam.
    // Drive the store action directly (integration: store state → component re-render).
    act(() => {
      usePromptTesterStore.getState().setModelParam(modelId, 'temp', 1.5);
    });

    const updatedModel = usePromptTesterStore.getState().models.find(m => m.id === modelId);
    expect(updatedModel?.params.temp).toBe(1.5);
  });

  it('should display formatted value in DOM after store temp param update (FR-024)', () => {
    // expanded:true required — value cells are hidden when card is collapsed
    const modelId = seedModel({ expanded: true });

    render(<ModelCardContainer modelId={modelId} />);

    act(() => {
      usePromptTesterStore.getState().setModelParam(modelId, 'temp', 1.5);
    });

    // ModelParamsList renders each param value inside an <input type="number"> (spinbutton)
    const numericInputs = screen.getAllByRole('spinbutton');
    const tempInput = numericInputs.find(el => (el as HTMLInputElement).value === '1.5');
    expect(tempInput).toBeDefined();
    expect((tempInput as HTMLInputElement).value).toBe('1.5');
  });

  // =========================================================================
  // FR-025 — Thinking pill click toggles thinking flag in store
  // =========================================================================

  it('should toggle thinking to true in store when thinking pill is clicked', () => {
    // expanded:true required — thinking pill is hidden when card is collapsed
    const modelId = seedModel({ supportsThinking: true, expanded: true });

    // addModel sets thinking=true for the first model with supportsThinking.
    // Toggle to false before render so we can verify the false→true toggle path.
    act(() => {
      usePromptTesterStore.getState().toggleModelThinking(modelId); // true → false
    });

    render(<ModelCardContainer modelId={modelId} />);

    // Pill renders: <span onClick={onToggleThinking}><span>{children}</span></span>
    // getByText finds the inner <span>; fireEvent.click bubbles up to the outer span's onClick
    const thinkingText = screen.getByText('lab.modelCard.thinking');
    act(() => {
      fireEvent.click(thinkingText);
    });

    const updatedModel = usePromptTesterStore.getState().models.find(m => m.id === modelId);
    expect(updatedModel?.thinking).toBe(true);
  });

  it('should toggle thinking to false when pill is clicked while thinking is on', () => {
    // expanded:true required — thinking pill is hidden when card is collapsed
    const modelId = seedModel({ supportsThinking: true, expanded: true });

    render(<ModelCardContainer modelId={modelId} />);

    const thinkingText = screen.getByText('lab.modelCard.thinkingOn');
    act(() => {
      fireEvent.click(thinkingText);
    });

    const updatedModel = usePromptTesterStore.getState().models.find(m => m.id === modelId);
    expect(updatedModel?.thinking).toBe(false);
  });

  // =========================================================================
  // FR-027 — clampModelParam triggers amber border flash, removed after 200ms
  // =========================================================================

  it('should apply border-amber-500 class immediately after slider blur triggers handleClampParam', () => {
    // expanded:true required — sliders are hidden when card is collapsed
    const modelId = seedModel({ expanded: true });

    const { container } = render(<ModelCardContainer modelId={modelId} />);

    // Radix SliderPrimitive.Root renders as [data-slot="slider"]; onBlur is on the Root.
    // fireEvent.blur on the Root triggers handleClampParam → setAmberFlash(true).
    const sliderRoot = container.querySelector('[data-slot="slider"]');
    act(() => {
      fireEvent.blur(sliderRoot!);
    });

    const article = container.querySelector('article');
    expect(article?.className).toMatch(/border-amber-500/);
  });

  it('should remove border-amber-500 class after 200ms', () => {
    // expanded:true required — sliders are hidden when card is collapsed
    const modelId = seedModel({ expanded: true });

    const { container } = render(<ModelCardContainer modelId={modelId} />);

    const sliderRoot = container.querySelector('[data-slot="slider"]');
    act(() => {
      fireEvent.blur(sliderRoot!);
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const article = container.querySelector('article');
    expect(article?.className).not.toMatch(/border-amber-500/);
  });

  // =========================================================================
  // Edge — returns null when model ID not found
  // =========================================================================

  it('should render nothing when modelId does not match any model in store', () => {
    const { container } = render(<ModelCardContainer modelId="non-existent-id" />);
    expect(container.firstChild).toBeNull();
  });

  // =========================================================================
  // T028 — popover thinking toggle (infoSlot) invokes toggleModelThinking
  // =========================================================================

  it('should invoke toggleModelThinking when popover thinking toggle is clicked', () => {
    const modelId = seedModel({ supportsThinking: true });

    render(<ModelCardContainer modelId={modelId} />);

    const toggle = screen.getByTestId('thinking-mode-toggle');
    const beforeThinking = usePromptTesterStore
      .getState()
      .models.find(m => m.id === modelId)?.thinking;

    act(() => {
      fireEvent.click(toggle);
    });

    const afterThinking = usePromptTesterStore
      .getState()
      .models.find(m => m.id === modelId)?.thinking;
    expect(afterThinking).toBe(!beforeThinking);
  });
});
