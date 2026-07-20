import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { SkillEditorVM } from '../types';

export interface SkillEditorLabels {
  readonly emptyStateMessage: string;
  readonly uncategorizedWarning: string;
  readonly fieldNameLabel: string;
  readonly fieldDescriptionLabel: string;
  readonly fieldDescriptionPlaceholder: string;
  readonly fieldPromptLabel: string;
  readonly fieldCommandPrefixLabel: string;
  readonly fieldCategoryLabel: string;
  readonly categoryNoneLabel: string;
  readonly categoryPersonaLabel: string;
  readonly categoryContextLabel: string;
  readonly categoryConstraintsLabel: string;
  readonly categoryFormatLabel: string;
  readonly categoryExamplesLabel: string;
  readonly saveLabel: string;
  readonly createLabel: string;
  readonly deleteLabel: string;
  readonly duplicateLabel: string;
  readonly cancelLabel: string;
  readonly actionsAriaLabel: string;
}

export interface SkillEditorProps {
  readonly skill: SkillEditorVM | null;
  readonly isNew: boolean;
  readonly name: string;
  readonly prompt: string;
  readonly category: 'persona' | 'context' | 'constraints' | 'format' | 'examples' | null;
  readonly commandPrefix: string;
  readonly description: string;
  readonly onNameChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onPromptChange: (value: string) => void;
  readonly onCategoryChange: (value: string) => void;
  readonly onCommandPrefixChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onCancel: () => void;
  readonly labels?: SkillEditorLabels;
  readonly className?: string;
}

interface CategoryOption {
  readonly value: string;
  readonly label: string;
}

const DEFAULT_LABELS: SkillEditorLabels = {
  emptyStateMessage: 'Select a skill to edit, or create a new one.',
  uncategorizedWarning:
    'This skill is uncategorized. Assign a category for proper prompt ordering.',
  fieldNameLabel: 'Name',
  fieldDescriptionLabel: 'Description',
  fieldDescriptionPlaceholder: 'Optional description for this skill...',
  fieldPromptLabel: 'Prompt',
  fieldCommandPrefixLabel: 'Command Prefix',
  fieldCategoryLabel: 'Category',
  categoryNoneLabel: 'None',
  categoryPersonaLabel: 'Persona',
  categoryContextLabel: 'Context',
  categoryConstraintsLabel: 'Constraints',
  categoryFormatLabel: 'Format',
  categoryExamplesLabel: 'Examples',
  saveLabel: 'Save',
  createLabel: 'Create',
  deleteLabel: 'Delete',
  duplicateLabel: 'Duplicate',
  cancelLabel: 'Cancel',
  actionsAriaLabel: 'Skill actions',
};

const buildCategoryOptions = (l: SkillEditorLabels): readonly CategoryOption[] => [
  { value: 'none', label: l.categoryNoneLabel },
  { value: 'persona', label: l.categoryPersonaLabel },
  { value: 'context', label: l.categoryContextLabel },
  { value: 'constraints', label: l.categoryConstraintsLabel },
  { value: 'format', label: l.categoryFormatLabel },
  { value: 'examples', label: l.categoryExamplesLabel },
];

const toCategorySelectValue = (category: SkillEditorProps['category']): string =>
  category ?? 'none';

export function SkillEditor({
  skill,
  isNew,
  name,
  prompt,
  category,
  commandPrefix,
  description,
  onNameChange,
  onDescriptionChange,
  onPromptChange,
  onCategoryChange,
  onCommandPrefixChange,
  onSave,
  onDelete,
  onDuplicate,
  onCancel,
  labels = DEFAULT_LABELS,
  className,
}: SkillEditorProps): React.ReactElement {
  if (skill === null) {
    return (
      <div className={cn('flex items-center justify-center p-8', className)}>
        <p className="text-muted-foreground text-sm">{labels.emptyStateMessage}</p>
      </div>
    );
  }

  const isBuiltin = skill.type === 'builtin';
  const showDelete = !isNew;
  const categorySelectValue = toCategorySelectValue(category);
  const showUncategorizedWarning = category === null;
  const saveButtonLabel = isNew ? labels.createLabel : labels.saveLabel;
  const categoryOptions = buildCategoryOptions(labels);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onNameChange(e.target.value);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    onDescriptionChange(e.target.value);
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    onPromptChange(e.target.value);
  };

  const handleCommandPrefixChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onCommandPrefixChange(e.target.value);
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 pr-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-name">{labels.fieldNameLabel}</Label>
            <Input
              id="skill-name"
              value={name}
              onChange={handleNameChange}
              disabled={isBuiltin}
              aria-label={labels.fieldNameLabel}
              data-testid="skills-name-input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-description">{labels.fieldDescriptionLabel}</Label>
            <Textarea
              id="skill-description"
              value={description}
              onChange={handleDescriptionChange}
              disabled={isBuiltin}
              aria-label={labels.fieldDescriptionLabel}
              placeholder={labels.fieldDescriptionPlaceholder}
              rows={2}
              maxLength={500}
              data-testid="skills-description-input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-prompt">{labels.fieldPromptLabel}</Label>
            <Textarea
              id="skill-prompt"
              value={prompt}
              onChange={handlePromptChange}
              disabled={isBuiltin}
              aria-label={labels.fieldPromptLabel}
              rows={8}
              data-testid="skills-prompt-input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="skill-command-prefix">{labels.fieldCommandPrefixLabel}</Label>
            <Input
              id="skill-command-prefix"
              value={commandPrefix}
              onChange={handleCommandPrefixChange}
              disabled={isBuiltin}
              aria-label={labels.fieldCommandPrefixLabel}
              data-testid="skills-command-prefix-input"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{labels.fieldCategoryLabel}</Label>
            <Select value={categorySelectValue} onValueChange={onCategoryChange}>
              <SelectTrigger
                aria-label={labels.fieldCategoryLabel}
                data-testid="skills-category-select"
              >
                <SelectValue placeholder={labels.categoryNoneLabel} />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {categoryOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showUncategorizedWarning && (
              <p className="text-warning text-sm text-yellow-600">{labels.uncategorizedWarning}</p>
            )}
          </div>

          <fieldset className="flex gap-2 border-0 p-0" aria-label={labels.actionsAriaLabel}>
            <Button onClick={onSave} aria-label={saveButtonLabel}>
              {saveButtonLabel}
            </Button>
            {showDelete && (
              <Button variant="destructive" onClick={onDelete} aria-label={labels.deleteLabel}>
                {labels.deleteLabel}
              </Button>
            )}
            {!isNew && (
              <Button variant="outline" onClick={onDuplicate} aria-label={labels.duplicateLabel}>
                {labels.duplicateLabel}
              </Button>
            )}
            <Button variant="ghost" onClick={onCancel} aria-label={labels.cancelLabel}>
              {labels.cancelLabel}
            </Button>
          </fieldset>
        </div>
      </ScrollArea>
    </div>
  );
}
