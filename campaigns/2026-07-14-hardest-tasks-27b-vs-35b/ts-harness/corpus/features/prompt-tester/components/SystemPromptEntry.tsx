import { X } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SystemPromptEntryLabels {
  readonly remove: string;
  readonly editedBy: string;
  readonly skillMeta: string;
}

export interface SystemPromptEntryProps {
  readonly id: string;
  readonly index: number;
  readonly kind: 'manual' | 'skill';
  readonly skillName?: string;
  readonly editedBy?: string;
  readonly axisLabel?: string;
  readonly label?: string;
  readonly preview?: string;
  readonly onRemove: (index: number) => void;
  readonly onEntryClick: (id: string) => void;
  readonly labels: SystemPromptEntryLabels;
  readonly className?: string;
}

const DEFAULT_PREVIEW_MAX = 120;

function truncatePreview(text: string, max: number = DEFAULT_PREVIEW_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function getMetaText(
  kind: 'manual' | 'skill',
  skillName: string | undefined,
  editedByOverride: string | undefined,
  labels: SystemPromptEntryLabels
): string {
  if (kind === 'skill') {
    return `${labels.skillMeta}${skillName ?? ''}`;
  }
  return editedByOverride ?? labels.editedBy;
}

export function SystemPromptEntry({
  id,
  index,
  kind,
  skillName,
  editedBy,
  axisLabel,
  label,
  preview,
  onRemove,
  onEntryClick,
  labels,
  className,
}: SystemPromptEntryProps): React.ReactElement {
  const handleRemove = (): void => onRemove(index);
  const handleClick = (): void => onEntryClick(id);
  const metaText = label ?? getMetaText(kind, skillName, editedBy, labels);
  const badgeText = axisLabel ?? `S${index}`;

  const handleRemoveClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    handleRemove();
  };

  return (
    <button
      type="button"
      data-testid="system-prompt-entry"
      data-kind={kind}
      onClick={handleClick}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border border-border p-2.5 text-left hover:bg-muted cursor-pointer',
        className
      )}
    >
      <div className="flex w-full flex-row items-center gap-2">
        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/40 text-foreground">
          {badgeText}
        </span>
        <span className="text-xs text-muted-foreground flex-1">{metaText}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRemoveClick}
          aria-label={labels.remove}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      {preview ? (
        <p
          data-testid="system-prompt-entry-preview"
          className="font-mono text-sm text-muted-foreground leading-snug line-clamp-2"
        >
          {truncatePreview(preview)}
        </p>
      ) : null}
    </button>
  );
}
