import type { ReactElement, ReactNode } from 'react';

const PROVIDER_FIELD_ID = 'eval-provider-select';
const MODEL_FIELD_ID = 'eval-model-select';

export interface EvalModelSectionLabels {
  readonly provider: string;
  readonly model: string;
}

const DEFAULT_FIELD_LABELS: EvalModelSectionLabels = {
  provider: 'Provider',
  model: 'Model',
};

export interface EvalModelSectionProps {
  readonly heading: string;
  readonly description: string;
  readonly emptyHint: string;
  readonly showEmptyHint: boolean;
  readonly providerSlot: ReactNode;
  readonly modelSlot: ReactNode;
  readonly fieldLabels?: EvalModelSectionLabels;
}

const renderEmptyHint = (showEmptyHint: boolean, emptyHint: string): ReactNode => {
  if (!showEmptyHint) {
    return null;
  }
  return (
    <p data-testid="mf-lab-eval-model-empty-hint" className="text-sm text-ink2">
      {emptyHint}
    </p>
  );
};

export function EvalModelSection({
  heading,
  description,
  emptyHint,
  showEmptyHint,
  providerSlot,
  modelSlot,
  fieldLabels = DEFAULT_FIELD_LABELS,
}: EvalModelSectionProps): ReactElement {
  return (
    <section
      data-testid="mf-lab-eval-model-section"
      className="mx-auto max-w-2xl space-y-4 rounded-lg border border-line bg-panel p-5"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold text-ink">{heading}</h2>
        <p className="text-sm text-ink2">{description}</p>
      </header>

      <div className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={PROVIDER_FIELD_ID} className="text-sm font-medium text-ink">
            {fieldLabels.provider}
          </label>
          {providerSlot}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={MODEL_FIELD_ID} className="text-sm font-medium text-ink">
            {fieldLabels.model}
          </label>
          {modelSlot}
        </div>
      </div>

      {renderEmptyHint(showEmptyHint, emptyHint)}
    </section>
  );
}
