import type * as React from 'react';

import type { SessionItemLabels } from './SessionItem';
import { SessionItem } from './SessionItem';

interface SessionDisplay {
  readonly id: string;
  readonly title: string;
  readonly tooltipText?: string;
  readonly metaLine?: string;
}

export interface SessionListProps {
  readonly sessions: readonly SessionDisplay[];
  readonly activeSessionId: string | null;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onDeleteSession: (sessionId: string) => void;
  readonly editingSessionId?: string | null;
  readonly editValue?: string;
  readonly onEditValueChange?: (value: string) => void;
  readonly onDoubleClickSession?: (sessionId: string) => void;
  readonly onConfirmEdit?: () => void;
  readonly onCancelEdit?: () => void;
  readonly noChatsLabel?: string;
  readonly chatSessionsAriaLabel?: string;
  readonly sessionItemLabels?: SessionItemLabels;
}

const makeSelectHandler =
  (id: string, onSelect: (id: string) => void): (() => void) =>
    (): void => {
      onSelect(id);
    };
const makeDeleteHandler =
  (id: string, onDelete: (id: string) => void): (() => void) =>
    (): void => {
      onDelete(id);
    };
const makeDoubleClickHandler =
  (id: string, onDoubleClick: ((id: string) => void) | undefined): (() => void) =>
    (): void => {
      onDoubleClick?.(id);
    };

export function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  editingSessionId,
  editValue,
  onEditValueChange,
  onDoubleClickSession,
  onConfirmEdit,
  onCancelEdit,
  noChatsLabel = 'No chats yet',
  chatSessionsAriaLabel = 'Chat sessions',
  sessionItemLabels,
}: SessionListProps): React.ReactElement {
  return (
    <nav aria-label={chatSessionsAriaLabel}>
      {sessions.length === 0 && (
        <p className="text-muted-foreground px-3 py-2 text-xs">{noChatsLabel}</p>
      )}
      {sessions.map(session => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onSelect={makeSelectHandler(session.id, onSelectSession)}
          onDelete={makeDeleteHandler(session.id, onDeleteSession)}
          tooltipText={session.tooltipText}
          metaLine={session.metaLine}
          isEditing={editingSessionId === session.id}
          editValue={editingSessionId === session.id ? editValue : undefined}
          onEditValueChange={editingSessionId === session.id ? onEditValueChange : undefined}
          onDoubleClick={makeDoubleClickHandler(session.id, onDoubleClickSession)}
          onConfirmEdit={onConfirmEdit}
          onCancelEdit={onCancelEdit}
          labels={sessionItemLabels}
        />
      ))}
    </nav>
  );
}
