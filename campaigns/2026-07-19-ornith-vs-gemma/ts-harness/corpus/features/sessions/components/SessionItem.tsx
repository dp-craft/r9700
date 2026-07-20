import { Trash2 } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface SessionItemLabels {
  readonly selectChatAriaPrefix?: string;
  readonly deleteChatAriaLabel?: string;
  readonly deleteDialogTitle?: string;
  readonly deleteDialogDescription?: string;
  readonly cancelLabel?: string;
  readonly deleteLabel?: string;
}

export interface SessionItemProps {
  readonly session: { readonly id: string; readonly title: string };
  readonly isActive: boolean;
  readonly onSelect: () => void;
  readonly onDelete: () => void;
  readonly labels?: SessionItemLabels;
  readonly tooltipText?: string;
  readonly metaLine?: string;
  readonly isEditing?: boolean;
  readonly editValue?: string;
  readonly onEditValueChange?: (value: string) => void;
  readonly onDoubleClick?: () => void;
  readonly onConfirmEdit?: () => void;
  readonly onCancelEdit?: () => void;
}

const getSessionButtonClassName = (isActive: boolean): string =>
  cn(
    'block w-full flex-1 rounded-md px-3 py-2 text-left transition-colors',
    isActive ? 'bg-accent font-medium border border-border' : 'hover:bg-muted'
  );

const getSelectAriaLabel = (prefix: string | undefined, title: string): string => {
  const resolvedPrefix = prefix ?? 'Select chat:';
  return `${resolvedPrefix} ${title}`;
};

const handleEditInputKeyDown =
  (
    onConfirmEdit: (() => void) | undefined,
    onCancelEdit: (() => void) | undefined
  ): React.KeyboardEventHandler<HTMLInputElement> =>
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter') {
        onConfirmEdit?.();
      }
      if (e.key === 'Escape') {
        onCancelEdit?.();
      }
    };

const handleEditInputChange =
  (
    onEditValueChange: ((value: string) => void) | undefined
  ): React.ChangeEventHandler<HTMLInputElement> =>
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      onEditValueChange?.(e.target.value);
    };

const handleEditInputBlur =
  (onConfirmEdit: (() => void) | undefined): React.FocusEventHandler<HTMLInputElement> =>
    (): void => {
      onConfirmEdit?.();
    };

export const SessionItem: React.NamedExoticComponent<SessionItemProps> = React.memo(
  function SessionItem({
    session,
    isActive,
    onSelect,
    onDelete,
    labels,
    tooltipText,
    isEditing,
    editValue,
    onEditValueChange,
    onDoubleClick,
    onConfirmEdit,
    onCancelEdit,
    metaLine,
  }: SessionItemProps): React.ReactElement {
    const sessionButtonClassName = getSessionButtonClassName(isActive);
    const selectAriaLabel = getSelectAriaLabel(labels?.selectChatAriaPrefix, session.title);
    const deleteChatAriaLabel = labels?.deleteChatAriaLabel ?? 'Delete chat';
    const deleteDialogTitle = labels?.deleteDialogTitle ?? 'Delete this chat?';
    const deleteDialogDescription =
      labels?.deleteDialogDescription ?? 'This action cannot be undone.';
    const cancelLabel = labels?.cancelLabel ?? 'Cancel';
    const deleteLabel = labels?.deleteLabel ?? 'Delete';

    return (
      <div
        className="group flex w-full items-center gap-1"
        data-testid={`session-item-${session.id}`}
      >
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={handleEditInputChange(onEditValueChange)}
            onKeyDown={handleEditInputKeyDown(onConfirmEdit, onCancelEdit)}
            onBlur={handleEditInputBlur(onConfirmEdit)}
            className="flex-1 truncate rounded-md px-3 py-2 text-left text-sm bg-transparent outline-none ring-1 ring-ring"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- inline edit requires auto-focus on activation
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={onDoubleClick}
            className={sessionButtonClassName}
            aria-current={isActive ? 'page' : undefined}
            aria-label={selectAriaLabel}
            title={tooltipText}
          >
            <span className="block truncate text-sm">{session.title}</span>
            {metaLine && (
              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                {metaLine}
              </span>
            )}
          </button>
        )}

        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={deleteChatAriaLabel}
              className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{deleteDialogTitle}</DialogTitle>
              <DialogDescription>{deleteDialogDescription}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{cancelLabel}</Button>
              </DialogClose>
              <Button variant="destructive" onClick={onDelete}>
                {deleteLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
);
