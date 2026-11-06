import { Info } from 'lucide-react';
import type * as React from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Locale } from '@/i18n/types';
import { cn } from '@/lib/utils';

interface LanguageOption {
  readonly value: Locale;
  readonly label: string;
}

const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: 'hu', label: 'Magyar' },
  { value: 'en', label: 'English' },
] as const;

export interface LanguageSectionProps {
  readonly uiLanguage: Locale;
  readonly conversationLanguage: Locale;
  readonly promptLanguage: Locale;
  readonly onUiLanguageChange: (locale: Locale) => void;
  readonly onConversationLanguageChange: (locale: Locale) => void;
  readonly onPromptLanguageChange: (locale: Locale) => void;
  readonly isTranslationNeeded: boolean;
  readonly translationModelSlot: React.ReactNode;
  readonly uiLanguageLabel: string;
  readonly conversationLanguageLabel: string;
  readonly modelLanguageLabel: string;
  readonly modelLanguageTooltip?: string;
  readonly translationModelTooltip?: string;
  readonly sectionTitle: string;
  readonly className?: string;
}

function castToLocale(value: string): Locale {
  return value as Locale;
}

function createLocaleHandler(onChange: (locale: Locale) => void): (value: string) => void {
  return (value: string) => onChange(castToLocale(value));
}

function LanguageSelect({
  id,
  label,
  value,
  onValueChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: Locale;
  readonly onValueChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          id={id}
          className="w-[140px]"
          aria-label={label}
          data-testid={`settings-${id}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {LANGUAGE_OPTIONS.map(({ value: optionValue, label: optionLabel }) => (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InfoTooltip({ text }: { readonly text: string }): React.ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="text-muted-foreground inline h-4 w-4 cursor-help" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function LanguageSection({
  uiLanguage,
  conversationLanguage,
  promptLanguage,
  onUiLanguageChange,
  onConversationLanguageChange,
  onPromptLanguageChange,
  isTranslationNeeded,
  translationModelSlot,
  uiLanguageLabel,
  conversationLanguageLabel,
  modelLanguageLabel,
  modelLanguageTooltip,
  translationModelTooltip,
  sectionTitle,
  className,
}: LanguageSectionProps): React.ReactElement {
  const handleUiLanguageChange = createLocaleHandler(onUiLanguageChange);
  const handleConversationLanguageChange = createLocaleHandler(onConversationLanguageChange);
  const handleModelLanguageChange = createLocaleHandler(onPromptLanguageChange);

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="language-section-title">
      <h4 id="language-section-title" className="text-sm font-medium">
        {sectionTitle}
      </h4>
      <div className="space-y-3">
        <LanguageSelect
          id="ui-language"
          label={uiLanguageLabel}
          value={uiLanguage}
          onValueChange={handleUiLanguageChange}
        />
        <div className="flex items-center gap-1">
          <div className="flex-1">
            <LanguageSelect
              id="model-language"
              label={modelLanguageLabel}
              value={promptLanguage}
              onValueChange={handleModelLanguageChange}
            />
          </div>
          {modelLanguageTooltip !== undefined && <InfoTooltip text={modelLanguageTooltip} />}
        </div>
        <LanguageSelect
          id="conversation-language"
          label={conversationLanguageLabel}
          value={conversationLanguage}
          onValueChange={handleConversationLanguageChange}
        />
      </div>
      {isTranslationNeeded && (
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-1">
            <div className="flex-1">{translationModelSlot}</div>
            {translationModelTooltip !== undefined && (
              <InfoTooltip text={translationModelTooltip} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
