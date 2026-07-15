import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ModelParamsPopoverProps {
  readonly temperature: number;
  readonly maxTokens: number;
  readonly topP: number;
  readonly contextSize: number;
  readonly thinkingEnabled: boolean;
  readonly thinkingBudget: number;
  readonly supportsThinking: boolean;
  readonly isAtDefaults: boolean;
  readonly onTemperatureChange: (value: number) => void;
  readonly onMaxTokensChange: (value: number) => void;
  readonly onTopPChange: (value: number) => void;
  readonly onContextSizeChange: (value: number) => void;
  readonly onThinkingEnabledChange: (enabled: boolean) => void;
  readonly onThinkingBudgetChange: (value: number) => void;
  readonly onReset: () => void;
  readonly labels?: ModelParamsLabels;
  readonly className?: string;
}

interface ParamSliderRowProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly tooltip: string;
  readonly onValueChange: (value: number) => void;
  readonly onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export interface ModelParamsLabels {
  readonly temperature: string;
  readonly maxTokens: string;
  readonly topP: string;
  readonly contextSize: string;
  readonly thinking: string;
  readonly thinkingBudget: string;
  readonly resetToDefaults: string;
  readonly temperatureTooltip: string;
  readonly maxTokensTooltip: string;
  readonly topPTooltip: string;
  readonly contextSizeTooltip: string;
  readonly thinkingTooltip: string;
  readonly thinkingBudgetTooltip: string;
}

const DEFAULT_LABELS: ModelParamsLabels = {
  temperature: 'Temperature',
  maxTokens: 'Max Tokens',
  topP: 'Top P',
  contextSize: 'Context Size',
  thinking: 'Thinking',
  thinkingBudget: 'Thinking Budget',
  resetToDefaults: 'Reset to defaults',
  temperatureTooltip: 'Controls randomness. Lower values are more deterministic.',
  maxTokensTooltip: 'Maximum number of tokens in the response.',
  topPTooltip: 'Nucleus sampling. Lower values focus on more likely tokens.',
  contextSizeTooltip: 'Context window size (tokens) the model keeps in memory.',
  thinkingTooltip: 'Enable extended thinking for complex reasoning tasks.',
  thinkingBudgetTooltip: 'Token budget allocated for the thinking process.',
};

function handleSliderChange(callback: (value: number) => void): (values: number[]) => void {
  return (values: number[]): void => {
    callback(values[0]);
  };
}

function handleInputChange(
  callback: (value: number) => void
): (e: React.ChangeEvent<HTMLInputElement>) => void {
  return (e: React.ChangeEvent<HTMLInputElement>): void => {
    const parsed = Number(e.target.value);
    if (!Number.isNaN(parsed)) {
      callback(parsed);
    }
  };
}

function ParamSliderRow({
  label,
  value,
  min,
  max,
  step,
  tooltip,
  onValueChange,
  onInputChange,
}: ParamSliderRowProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            value={value}
            onChange={onInputChange}
            min={min}
            max={max}
            step={step}
            className="h-7 w-16 rounded-md border border-input bg-transparent px-2 text-right text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${label} value`}
          />
          <InfoTooltip content={tooltip} />
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={handleSliderChange(onValueChange)}
        aria-label={label}
      />
    </div>
  );
}

function InfoTooltip({ content }: { readonly content: string }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
        >
          <Info className="size-3.5" />
          <span className="sr-only">Info</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56 text-xs">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

export function ModelParamsPopover({
  temperature,
  maxTokens,
  topP,
  contextSize,
  thinkingEnabled,
  thinkingBudget,
  supportsThinking,
  isAtDefaults,
  onTemperatureChange,
  onMaxTokensChange,
  onTopPChange,
  onContextSizeChange,
  onThinkingEnabledChange,
  onThinkingBudgetChange,
  onReset,
  labels,
  className,
}: ModelParamsPopoverProps): React.JSX.Element {
  const l = labels ?? DEFAULT_LABELS;

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex flex-col gap-4 p-1', className)}>
        <ParamSliderRow
          label={l.temperature}
          value={temperature}
          min={0}
          max={2}
          step={0.1}
          tooltip={l.temperatureTooltip}
          onValueChange={onTemperatureChange}
          onInputChange={handleInputChange(onTemperatureChange)}
        />

        <ParamSliderRow
          label={l.maxTokens}
          value={maxTokens}
          min={1}
          max={32768}
          step={1}
          tooltip={l.maxTokensTooltip}
          onValueChange={onMaxTokensChange}
          onInputChange={handleInputChange(onMaxTokensChange)}
        />

        <ParamSliderRow
          label={l.topP}
          value={topP}
          min={0}
          max={1}
          step={0.05}
          tooltip={l.topPTooltip}
          onValueChange={onTopPChange}
          onInputChange={handleInputChange(onTopPChange)}
        />

        <ParamSliderRow
          label={l.contextSize}
          value={contextSize}
          min={512}
          max={131072}
          step={512}
          tooltip={l.contextSizeTooltip}
          onValueChange={onContextSizeChange}
          onInputChange={handleInputChange(onContextSizeChange)}
        />

        {supportsThinking && (
          <>
            <Separator />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{l.thinking}</span>
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={thinkingEnabled}
                    onCheckedChange={onThinkingEnabledChange}
                    aria-label={l.thinking}
                  />
                  <InfoTooltip content={l.thinkingTooltip} />
                </div>
              </div>

              {thinkingEnabled && (
                <ParamSliderRow
                  label={l.thinkingBudget}
                  value={thinkingBudget}
                  min={1024}
                  max={32768}
                  step={1024}
                  tooltip={l.thinkingBudgetTooltip}
                  onValueChange={onThinkingBudgetChange}
                  onInputChange={handleInputChange(onThinkingBudgetChange)}
                />
              )}
            </div>
          </>
        )}

        <Separator />

        <Button
          variant="ghost"
          size="sm"
          disabled={isAtDefaults}
          onClick={onReset}
          className="w-full"
        >
          {l.resetToDefaults}
        </Button>
      </div>
    </TooltipProvider>
  );
}
