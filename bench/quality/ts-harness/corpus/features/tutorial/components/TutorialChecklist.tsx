import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { TutorialGoalId } from '../types';
import { TutorialChecklistItem } from './TutorialChecklistItem';

interface TutorialChecklistItemViewModel {
  readonly id: TutorialGoalId;
  readonly title: string;
  readonly description: string;
  readonly isCompleted: boolean;
  readonly isHighlighted: boolean;
}

export interface TutorialChecklistLabels {
  readonly closeTutorial: string;
  readonly tutorialGoals: string;
  readonly allGoalsCompleted: string;
  readonly dismiss: string;
  readonly restart: string;
  readonly checklistAria: string;
  readonly title: string;
  readonly itemCompleted: string;
  readonly itemPending: string;
}

const DEFAULT_CHECKLIST_LABELS: TutorialChecklistLabels = {
  closeTutorial: 'Close tutorial checklist',
  tutorialGoals: 'Tutorial goals',
  allGoalsCompleted: 'All goals completed!',
  dismiss: 'Dismiss',
  restart: 'Restart',
  checklistAria: 'Tutorial checklist: {{completed}} of {{total}} completed',
  title: 'Tutorial',
  itemCompleted: 'completed',
  itemPending: 'pending',
};

export interface TutorialChecklistProps {
  readonly items: readonly TutorialChecklistItemViewModel[];
  readonly completedCount: number;
  readonly totalCount: number;
  readonly isCompleted: boolean;
  readonly onDismiss: () => void;
  readonly onRestart: () => void;
  readonly onClose: () => void;
  readonly labels?: TutorialChecklistLabels;
  readonly className?: string;
}

const handleKeyDown =
  (onClose: () => void): ((e: React.KeyboardEvent<HTMLDivElement>) => void) =>
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

const renderItemFactory =
  (completedLabel: string, pendingLabel: string) =>
    (item: TutorialChecklistItemViewModel): React.ReactElement => (
      <TutorialChecklistItem
        key={item.id}
        id={item.id}
        title={item.title}
        description={item.description}
        isCompleted={item.isCompleted}
        isHighlighted={item.isHighlighted}
        statusCompletedLabel={completedLabel}
        statusPendingLabel={pendingLabel}
      />
    );

function buildCelebrationMessage(text: string): React.ReactElement {
  return <p className="px-3 py-2 text-center text-sm font-medium text-green-500">{text}</p>;
}

export function TutorialChecklist({
  items,
  completedCount,
  totalCount,
  isCompleted,
  onDismiss,
  onRestart,
  onClose,
  labels,
  className,
}: TutorialChecklistProps): React.ReactElement {
  const l = labels ?? DEFAULT_CHECKLIST_LABELS;
  const checklistAria = l.checklistAria
    .replace('{{completed}}', String(completedCount))
    .replace('{{total}}', String(totalCount));
  // Escape-to-close is a convenience handler on the landmark <aside>; the primary,
  // genuinely-focusable close affordance is the close <Button> in the header.
  const keyboardHandlers = { onKeyDown: handleKeyDown(onClose) };

  return (
    <aside
      aria-label={checklistAria}
      data-testid="tutorial-checklist"
      {...keyboardHandlers}
      className={cn(
        'flex w-80 flex-col bg-card border border-border rounded-lg shadow-lg',
        'max-h-[calc(100vh-6rem)]',
        className
      )}
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">
          {l.title} {completedCount}/{totalCount}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={l.closeTutorial}
          onClick={onClose}
          data-testid="tutorial-checklist-close"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <ul className="flex flex-col gap-1 p-2" aria-label={l.tutorialGoals}>
          {items.map(renderItemFactory(l.itemCompleted, l.itemPending))}
        </ul>
        {isCompleted && buildCelebrationMessage(l.allGoalsCompleted)}
      </ScrollArea>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          data-testid="tutorial-checklist-dismiss"
        >
          {l.dismiss}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onRestart}
          data-testid="tutorial-checklist-restart"
        >
          {l.restart}
        </Button>
      </footer>
    </aside>
  );
}
