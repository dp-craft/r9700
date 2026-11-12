import * as React from 'react';

import { cn } from '@/lib/utils';

export interface PipelineProgressProps {
  readonly currentStepId: string | null;
  readonly currentStepLabel: string | null;
  readonly completedSteps: readonly string[];
  readonly translatingInputLabel: string;
  readonly generatingResponseLabel: string;
  readonly translatingOutputLabel: string;
  readonly progressAriaLabel?: string;
  readonly stateLabels?: {
    readonly active: string;
    readonly completed: string;
    readonly pending: string;
  };
}

const DEFAULT_PROGRESS_ARIA = 'Pipeline progress';
const DEFAULT_STATE_LABELS = {
  active: 'active',
  completed: 'completed',
  pending: 'pending',
} as const;

const STEP_ORDER = ['translate-input', 'main-llm', 'translate-output'] as const;

type StepId = (typeof STEP_ORDER)[number];

const getLabelForStepId = (
  stepId: StepId,
  props: Pick<
    PipelineProgressProps,
    'translatingInputLabel' | 'generatingResponseLabel' | 'translatingOutputLabel'
  >
): string => {
  const labelMap: Record<StepId, string> = {
    'translate-input': props.translatingInputLabel,
    'main-llm': props.generatingResponseLabel,
    'translate-output': props.translatingOutputLabel,
  };
  return labelMap[stepId];
};

const getStepState = (
  stepId: StepId,
  currentStepId: string | null,
  completedSteps: readonly string[]
): 'active' | 'completed' | 'pending' => {
  if (completedSteps.includes(stepId)) return 'completed';
  if (stepId === currentStepId) return 'active';
  return 'pending';
};

interface StepIndicatorProps {
  readonly label: string;
  readonly state: 'active' | 'completed' | 'pending';
  readonly stateLabel: string;
}

function StepIndicator({ label, state, stateLabel }: StepIndicatorProps): React.ReactElement {
  const icon = state === 'completed' ? '✓' : state === 'active' ? '⟳' : '○';

  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs', {
        'text-muted-foreground line-through': state === 'completed',
        'text-foreground font-medium': state === 'active',
        'text-muted-foreground opacity-50': state === 'pending',
      })}
      title={`${label} — ${stateLabel}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

const isInactive = (currentStepId: string | null, completedSteps: readonly string[]): boolean =>
  currentStepId === null && completedSteps.length === 0;

function PipelineProgressInner({
  currentStepId,
  currentStepLabel,
  completedSteps,
  translatingInputLabel,
  generatingResponseLabel,
  translatingOutputLabel,
  progressAriaLabel = DEFAULT_PROGRESS_ARIA,
  stateLabels = DEFAULT_STATE_LABELS,
}: PipelineProgressProps): React.ReactElement | null {
  if (isInactive(currentStepId, completedSteps)) {
    return null;
  }

  const labelProps = { translatingInputLabel, generatingResponseLabel, translatingOutputLabel };

  const visibleSteps = STEP_ORDER.filter(stepId => {
    if (completedSteps.includes(stepId)) return true;
    if (stepId === currentStepId) return true;
    return false;
  });

  const resolvedCurrentLabel =
    currentStepId !== null && currentStepLabel !== null ? currentStepLabel : null;

  return (
    <output
      className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md px-3 py-1.5"
      aria-live="polite"
      aria-label={progressAriaLabel}
    >
      {visibleSteps.map((stepId, index) => {
        const state = getStepState(stepId, currentStepId, completedSteps);
        const label =
          state === 'active' && resolvedCurrentLabel !== null
            ? resolvedCurrentLabel
            : getLabelForStepId(stepId, labelProps);

        return (
          <React.Fragment key={stepId}>
            {index > 0 && (
              <span className="text-muted-foreground text-xs" aria-hidden="true">
                ·
              </span>
            )}
            <StepIndicator label={label} state={state} stateLabel={stateLabels[state]} />
          </React.Fragment>
        );
      })}
    </output>
  );
}

export const PipelineProgress: React.MemoExoticComponent<
  (props: PipelineProgressProps) => React.ReactElement | null
> = React.memo(PipelineProgressInner);
