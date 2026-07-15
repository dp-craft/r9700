import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ModelParamRowVM = {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly tooltip?: string;
};

export type ModelParamsListProps = {
  readonly rows: readonly ModelParamRowVM[];
  readonly editable: boolean;
  readonly supportsThinking?: boolean;
  readonly thinking?: boolean;
  readonly thinkingBudget?: number;
  readonly thinkingLabel?: string;
  readonly thinkingBudgetLabel?: string;
  readonly legendLabel?: string;
  readonly onChange?: (key: string, value: number) => void;
  readonly onBlur?: (key: string) => void;
  readonly onThinkingToggle?: (enabled: boolean) => void;
  readonly className?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const RowLabel = ({
  label,
  tooltip,
}: {
  readonly label: string;
  readonly tooltip?: string;
}): React.ReactElement => {
  if (tooltip === undefined) {
    return <span className="text-xs text-ink2">{label}</span>;
  }
  return (
    <span className="flex items-center gap-1 text-xs text-ink2">
      {label}
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={`${label} info`}
          className="inline-flex size-3.5 items-center justify-center rounded-full border border-ink2/40 text-[9px] text-ink2 leading-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          i
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </span>
  );
};

const ParamRow = ({
  row,
  editable,
  onSliderChange,
  onSliderBlur,
  onNumericChange,
}: {
  readonly row: ModelParamRowVM;
  readonly editable: boolean;
  readonly onSliderChange: (key: string) => (vals: readonly number[]) => void;
  readonly onSliderBlur?: (key: string) => () => void;
  readonly onNumericChange: (
    row: ModelParamRowVM
  ) => (event: React.ChangeEvent<HTMLInputElement>) => void;
}): React.ReactElement => (
  <div className="flex flex-col gap-1 py-0.5">
    <RowLabel label={row.label} tooltip={row.tooltip} />
    <div className="flex items-center gap-2">
      <Slider
        aria-label={row.label}
        value={[row.value]}
        min={row.min}
        max={row.max}
        step={row.step}
        disabled={!editable}
        className="flex-1"
        onValueChange={onSliderChange(row.key)}
        onBlur={onSliderBlur?.(row.key)}
      />
      <Input
        type="number"
        aria-label={`${row.label} value`}
        value={row.value}
        min={row.min}
        max={row.max}
        step={row.step}
        disabled={!editable}
        className="h-7 w-20 font-mono text-xs"
        onChange={onNumericChange(row)}
      />
    </div>
  </div>
);

const ThinkingRow = ({
  label,
  thinking,
  editable,
  onThinkingToggle,
}: {
  readonly label: string;
  readonly thinking: boolean;
  readonly editable: boolean;
  readonly onThinkingToggle?: (enabled: boolean) => void;
}): React.ReactElement => (
  <div className="flex items-center justify-between py-0.5">
    <span className="text-xs text-ink2">{label}</span>
    <Switch
      aria-label={label}
      checked={thinking}
      disabled={!editable}
      onCheckedChange={onThinkingToggle}
    />
  </div>
);

const BudgetRow = ({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.ReactElement => (
  <div className="flex items-center justify-between py-0.5">
    <span className="text-xs text-ink2">{label}</span>
    <span className="font-mono text-xs text-ink">{String(value)}</span>
  </div>
);

const makeSliderHandler =
  (onChange: ((key: string, value: number) => void) | undefined) =>
    (key: string) =>
      (vals: readonly number[]): void => {
        onChange?.(key, vals[0]);
      };

const makeBlurHandler =
  (onBlur: ((key: string) => void) | undefined) => (key: string) => (): void => {
    onBlur?.(key);
  };

const makeNumericHandler =
  (onChange: ((key: string, value: number) => void) | undefined) =>
    (row: ModelParamRowVM) =>
      (event: React.ChangeEvent<HTMLInputElement>): void => {
        const parsed = Number(event.target.value);
        if (Number.isNaN(parsed)) {
          return;
        }
        onChange?.(row.key, clamp(parsed, row.min, row.max));
      };

export const ModelParamsList = ({
  rows,
  editable,
  supportsThinking,
  thinking,
  thinkingBudget,
  thinkingLabel,
  thinkingBudgetLabel,
  legendLabel = 'Model parameters',
  onChange,
  onBlur,
  onThinkingToggle,
  className,
}: ModelParamsListProps): React.ReactElement => {
  const onSliderChange = makeSliderHandler(onChange);
  const onSliderBlur = makeBlurHandler(onBlur);
  const onNumericChange = makeNumericHandler(onChange);
  const showThinking = supportsThinking === true && editable;
  const showBudget = thinking === true && thinkingBudget !== undefined;

  return (
    <TooltipProvider>
      <fieldset className={cn('flex flex-col gap-0.5', className)} disabled={!editable}>
        <legend className="sr-only">{legendLabel}</legend>
        {showThinking && (
          <ThinkingRow
            label={thinkingLabel ?? 'Thinking'}
            thinking={thinking === true}
            editable={editable}
            onThinkingToggle={onThinkingToggle}
          />
        )}
        {rows.map(row => (
          <ParamRow
            key={row.key}
            row={row}
            editable={editable}
            onSliderChange={onSliderChange}
            onSliderBlur={onSliderBlur}
            onNumericChange={onNumericChange}
          />
        ))}
        {showBudget && <BudgetRow label={thinkingBudgetLabel ?? 'Budget'} value={thinkingBudget} />}
      </fieldset>
    </TooltipProvider>
  );
};
