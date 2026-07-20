import { X } from 'lucide-react';
import type { FocusEvent, KeyboardEvent, ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';

export type RunTabItem = {
  readonly id: string;
  readonly label: string;
};

export type RunTabsProps = {
  readonly tabs: readonly RunTabItem[];
  readonly activeId: string;
  readonly editingId: string | null;
  readonly canCloseActive: boolean;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onRenameStart: (id: string) => void;
  readonly onRenameCommit: (id: string, name: string) => void;
  readonly onRenameCancel: () => void;
  readonly addLabel: string;
  readonly onAdd: () => void;
  readonly endSlot?: ReactNode;
  readonly menuSlot?: (id: string) => ReactNode;
  readonly className?: string;
};

function handleRenameKeyDown(
  id: string,
  onRenameCommit: (id: string, name: string) => void,
  onRenameCancel: () => void
) {
  return (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = e.currentTarget.value.trim();
      if (trimmed === '') {
        onRenameCancel();
      } else {
        onRenameCommit(id, trimmed);
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onRenameCancel();
    }
  };
}

function handleRenameBlur(
  id: string,
  onRenameCommit: (id: string, name: string) => void,
  onRenameCancel: () => void
) {
  return (e: FocusEvent<HTMLInputElement>): void => {
    const trimmed = e.currentTarget.value.trim();
    if (trimmed === '') {
      onRenameCancel();
    } else {
      onRenameCommit(id, trimmed);
    }
  };
}

function handleInputRef(el: HTMLInputElement | null): void {
  if (el) {
    el.focus();
    el.select();
  }
}

function handleTabClick(
  id: string,
  isActive: boolean,
  onActivate: (id: string) => void,
  onRenameStart: (id: string) => void
) {
  return (): void => {
    if (isActive) {
      onRenameStart(id);
    } else {
      onActivate(id);
    }
  };
}

function handleCloseClick(id: string, onClose: (id: string) => void) {
  return (): void => {
    onClose(id);
  };
}

function renderTabContent(tab: RunTabItem, props: RunTabsProps): ReactElement {
  const isEditing = props.editingId === tab.id;

  if (isEditing) {
    return (
      <input
        type="text"
        defaultValue={tab.label}
        ref={handleInputRef}
        onKeyDown={handleRenameKeyDown(tab.id, props.onRenameCommit, props.onRenameCancel)}
        onBlur={handleRenameBlur(tab.id, props.onRenameCommit, props.onRenameCancel)}
        className="h-6 w-24 rounded border border-input bg-background px-1 text-xs"
        aria-label={`Rename ${tab.label}`}
      />
    );
  }

  return <span className="truncate text-xs">{tab.label}</span>;
}

export function RunTabs(props: RunTabsProps): ReactElement {
  const {
    tabs,
    activeId,
    canCloseActive,
    onClose,
    onActivate,
    onRenameStart,
    addLabel,
    onAdd,
    endSlot,
    menuSlot,
    className,
  } = props;

  return (
    <div
      role="tablist"
      className={cn(
        'flex w-full items-end gap-px border-b border-line bg-soft pl-3 pt-2',
        className
      )}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeId;
        const isCloseDisabled = isActive && !canCloseActive;

        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-label={tab.label}
            className={cn(
              'flex cursor-pointer items-center gap-1 rounded-t-lg border-l border-r border-line px-3.5 py-1.5 font-mono text-sm',
              isActive
                ? 'bg-panel border-t-2 border-t-accent -mb-px text-ink'
                : 'bg-transparent text-ink2 hover:bg-panel/40'
            )}
            onClick={handleTabClick(tab.id, isActive, onActivate, onRenameStart)}
            onKeyDown={undefined}
            tabIndex={0}
          >
            {renderTabContent(tab, props)}
            {menuSlot ? menuSlot(tab.id) : null}
            <Button
              variant="ghost"
              size="icon"
              className="-mr-1 ml-1 h-6 w-6 shrink-0"
              aria-label="Close tab"
              disabled={isCloseDisabled}
              onClick={handleCloseClick(tab.id, onClose)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 px-3.5 py-1.5 font-mono text-sm text-ink2"
        onClick={onAdd}
      >
        {addLabel}
      </Button>

      {endSlot ? <div className="mb-1 ml-auto mr-2 shrink-0">{endSlot}</div> : null}
    </div>
  );
}
