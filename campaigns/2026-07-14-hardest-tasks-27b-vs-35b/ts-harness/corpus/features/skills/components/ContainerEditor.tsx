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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import type { ComposedPromptVM, SortableSkillItemVM } from '../types';

export interface ContainerEditorLabels {
  readonly fieldNameLabel: string;
  readonly fieldSkillsLabel: string;
  readonly autoSortLabel: string;
  readonly addSkillPlaceholder: string;
  readonly addSkillAriaLabel: string;
  readonly tokenCountSuffix: string;
  readonly softLimitWarning: string;
  readonly hardLimitError: string;
  readonly actionsAriaLabel: string;
  readonly saveLabel: string;
  readonly createLabel: string;
  readonly cancelLabel: string;
  readonly deleteLabel: string;
}

export interface ContainerEditorProps {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly skills: readonly SortableSkillItemVM[];
  readonly availableSkills: readonly { readonly id: string; readonly name: string }[];
  readonly onAddSkill: (skillId: string) => void;
  readonly onRemoveSkill: (skillId: string) => void;
  readonly onAutoSort: () => void;
  readonly composedPrompt: ComposedPromptVM;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDelete: (() => void) | null;
  readonly isNew: boolean;
  readonly sortableListSlot: React.ReactNode;
  readonly infoSlot: React.ReactNode;
  readonly labels?: ContainerEditorLabels;
  readonly className?: string;
}

const DEFAULT_LABELS: ContainerEditorLabels = {
  fieldNameLabel: 'Name',
  fieldSkillsLabel: 'Skills',
  autoSortLabel: 'Auto-sort',
  addSkillPlaceholder: 'Add Skill...',
  addSkillAriaLabel: 'Add Skill',
  tokenCountSuffix: '{{count}} tokens',
  softLimitWarning: 'Warning: Approaching token soft limit',
  hardLimitError: 'Error: Token hard limit exceeded',
  actionsAriaLabel: 'Container actions',
  saveLabel: 'Save',
  createLabel: 'Create',
  cancelLabel: 'Cancel',
  deleteLabel: 'Delete',
};

const getSaveLabel = (isNew: boolean, labels: ContainerEditorLabels): string =>
  isNew ? labels.createLabel : labels.saveLabel;

const formatTokenCount = (count: number, suffix: string): string =>
  suffix.replace('{{count}}', String(count));

const getLimitMessage = (
  exceedsSoftLimit: boolean,
  exceedsHardLimit: boolean,
  labels: ContainerEditorLabels
): string | null => {
  if (exceedsHardLimit) return labels.hardLimitError;
  if (exceedsSoftLimit) return labels.softLimitWarning;
  return null;
};

const getLimitClassName = (exceedsHardLimit: boolean): string =>
  exceedsHardLimit ? 'text-destructive text-sm font-medium' : 'text-yellow-600 text-sm font-medium';

const createNameChangeHandler =
  (onNameChange: (name: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      onNameChange(e.target.value);
    };

export function ContainerEditor({
  name,
  onNameChange,
  availableSkills,
  onAddSkill,
  onAutoSort,
  composedPrompt,
  onSave,
  onCancel,
  onDelete,
  isNew,
  sortableListSlot,
  infoSlot,
  labels = DEFAULT_LABELS,
  className,
}: ContainerEditorProps): React.ReactElement {
  const saveLabel = getSaveLabel(isNew, labels);
  const limitMessage = getLimitMessage(
    composedPrompt.exceedsSoftLimit,
    composedPrompt.exceedsHardLimit,
    labels
  );
  const isSaveDisabled = composedPrompt.exceedsHardLimit;
  const handleNameChange = createNameChangeHandler(onNameChange);
  const limitClassName = getLimitClassName(composedPrompt.exceedsHardLimit);

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 pr-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="container-name">{labels.fieldNameLabel}</Label>
            <Input
              id="container-name"
              value={name}
              onChange={handleNameChange}
              aria-label={labels.fieldNameLabel}
            />
          </div>

          <Separator />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{labels.fieldSkillsLabel}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoSort}
              aria-label={labels.autoSortLabel}
            >
              {labels.autoSortLabel}
            </Button>
            {infoSlot}
          </div>

          {sortableListSlot}

          <Select onValueChange={onAddSkill} value="">
            <SelectTrigger aria-label={labels.addSkillAriaLabel}>
              <SelectValue placeholder={labels.addSkillPlaceholder} />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              {availableSkills.map(skill => (
                <SelectItem key={skill.id} value={skill.id}>
                  {skill.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {formatTokenCount(composedPrompt.tokenCount, labels.tokenCountSuffix)}
              </span>
              {limitMessage !== null && (
                <span className={limitClassName} role="alert">
                  {limitMessage}
                </span>
              )}
            </div>

            <ScrollArea className="bg-muted h-40 rounded-md border p-3">
              <pre className="text-muted-foreground text-xs whitespace-pre-wrap">
                {composedPrompt.text}
              </pre>
            </ScrollArea>
          </div>

          <Separator />

          <fieldset className="flex gap-2 border-0 p-0" aria-label={labels.actionsAriaLabel}>
            <Button onClick={onSave} disabled={isSaveDisabled} aria-label={saveLabel}>
              {saveLabel}
            </Button>
            <Button variant="ghost" onClick={onCancel} aria-label={labels.cancelLabel}>
              {labels.cancelLabel}
            </Button>
            {onDelete !== null && (
              <Button variant="destructive" onClick={onDelete} aria-label={labels.deleteLabel}>
                {labels.deleteLabel}
              </Button>
            )}
          </fieldset>
        </div>
      </ScrollArea>
    </div>
  );
}
