import React from 'react';

import { cn } from '@/lib/utils';

export interface TestPromptSectionProps {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly tokens: number;
  readonly maxTokens: number;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
  readonly variableChipLabel?: string;
  readonly fileChipLabel?: string;
  readonly tokenUnitLabel?: string;
  readonly className?: string;
}

function createTextareaChangeHandler(
  onChange: (text: string) => void
): (e: React.ChangeEvent<HTMLTextAreaElement>) => void {
  return (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value);
}

export const TestPromptSection: React.NamedExoticComponent<TestPromptSectionProps> = React.memo(
  function TestPromptSection({
    value,
    onChange,
    tokens,
    maxTokens,
    placeholder = 'Írd ide a user promptot...',
    ariaLabel = 'User prompt',
    variableChipLabel = 'változó',
    fileChipLabel = 'fájl',
    tokenUnitLabel = 'tok',
    className,
  }: TestPromptSectionProps): React.ReactElement {
    const handleChange = createTextareaChangeHandler(onChange);
    const isOver = tokens > maxTokens;

    return (
      <div className={cn('flex flex-col', className)}>
        <div className="min-h-[80px] border border-line rounded-t-lg px-3 py-2 text-sm bg-bg focus-within:ring-1 focus-within:ring-accent">
          <textarea
            value={value}
            onChange={handleChange}
            className="w-full min-h-[80px] resize-y bg-transparent outline-none text-sm"
            placeholder={placeholder}
            aria-label={ariaLabel}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 border border-t-0 border-line rounded-b-lg bg-muted/30">
          <span className="text-xs px-2 py-0.5 rounded-full border border-line text-muted-foreground">
            {variableChipLabel}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full border border-line text-muted-foreground">
            {fileChipLabel}
          </span>
          <span className="flex-1" />
          <span
            className={cn(
              'text-xs font-mono',
              isOver ? 'text-destructive font-semibold' : 'text-muted-foreground'
            )}
          >
            {tokens} / {maxTokens} {tokenUnitLabel}
          </span>
        </div>
      </div>
    );
  }
);
