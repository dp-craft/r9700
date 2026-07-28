import { Menu } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { LEFT_PANEL_WIDTH_REM } from '@/lib/layout-constants';

import type { SessionItemLabels } from './SessionItem';
import { SessionList } from './SessionList';

interface Session {
  readonly id: string;
  readonly title: string;
  readonly tooltipText?: string;
  readonly metaLine?: string;
}

export interface SessionSidebarProps {
  readonly sessions: readonly Session[];
  readonly activeSessionId: string | null;
  readonly canCreateSession: boolean;
  readonly onNewChat: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onDeleteSession: (sessionId: string) => void;
  readonly editingSessionId?: string | null;
  readonly editValue?: string;
  readonly onEditValueChange?: (value: string) => void;
  readonly onDoubleClickSession?: (sessionId: string) => void;
  readonly onConfirmEdit?: () => void;
  readonly onCancelEdit?: () => void;
  readonly header?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly skillSlot?: React.ReactNode;
  readonly newChatLabel?: string;
  readonly newChatAriaLabel?: string;
  readonly openSidebarLabel?: string;
  readonly navigationLabel?: string;
  readonly noChatsLabel?: string;
  readonly chatSessionsAriaLabel?: string;
  readonly sessionItemLabels?: SessionItemLabels;
}

interface SidebarContentProps {
  readonly sessions: readonly Session[];
  readonly activeSessionId: string | null;
  readonly canCreateSession: boolean;
  readonly onNewChat: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onDeleteSession: (sessionId: string) => void;
  readonly editingSessionId?: string | null;
  readonly editValue?: string;
  readonly onEditValueChange?: (value: string) => void;
  readonly onDoubleClickSession?: (sessionId: string) => void;
  readonly onConfirmEdit?: () => void;
  readonly onCancelEdit?: () => void;
  readonly header?: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly skillSlot?: React.ReactNode;
  readonly newChatLabel: string;
  readonly newChatAriaLabel: string;
  readonly noChatsLabel: string;
  readonly chatSessionsAriaLabel: string;
  readonly sessionItemLabels?: SessionItemLabels;
}

function SidebarContent({
  sessions,
  activeSessionId,
  canCreateSession,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  editingSessionId,
  editValue,
  onEditValueChange,
  onDoubleClickSession,
  onConfirmEdit,
  onCancelEdit,
  header,
  footer,
  skillSlot,
  newChatLabel,
  newChatAriaLabel,
  noChatsLabel,
  chatSessionsAriaLabel,
  sessionItemLabels,
}: SidebarContentProps): React.ReactElement {
  return (
    <>
      {header}
      <div className="flex flex-col gap-2 p-3">
        <Button
          className="w-full rounded-lg"
          onClick={onNewChat}
          disabled={!canCreateSession}
          aria-label={newChatAriaLabel}
          data-testid="new-chat-button"
        >
          {newChatLabel}
        </Button>
        {skillSlot}
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          editingSessionId={editingSessionId}
          editValue={editValue}
          onEditValueChange={onEditValueChange}
          onDoubleClickSession={onDoubleClickSession}
          onConfirmEdit={onConfirmEdit}
          onCancelEdit={onCancelEdit}
          noChatsLabel={noChatsLabel}
          chatSessionsAriaLabel={chatSessionsAriaLabel}
          sessionItemLabels={sessionItemLabels}
        />
      </div>
      {footer && (
        <>
          <Separator />
          <div className="p-3">{footer}</div>
        </>
      )}
    </>
  );
}

export function SessionSidebar({
  newChatLabel = '+ New Chat',
  newChatAriaLabel = 'New chat',
  openSidebarLabel = 'Open sidebar',
  navigationLabel = 'Navigation',
  noChatsLabel = 'No chats yet',
  chatSessionsAriaLabel = 'Chat sessions',
  sessionItemLabels,
  ...rest
}: SessionSidebarProps): React.ReactElement {
  return (
    <>
      <div
        data-testid="chat-sidebar"
        className="border-border from-card/60 to-card/30 hidden h-full shrink-0 flex-col border-r bg-gradient-to-b backdrop-blur-md md:flex"
        style={{ width: `${LEFT_PANEL_WIDTH_REM}rem` }}
      >
        <SidebarContent
          {...rest}
          newChatLabel={newChatLabel}
          newChatAriaLabel={newChatAriaLabel}
          noChatsLabel={noChatsLabel}
          chatSessionsAriaLabel={chatSessionsAriaLabel}
          sessionItemLabels={sessionItemLabels}
        />
      </div>

      <div className="flex md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="fixed top-3 left-3 z-50"
              aria-label={openSidebarLabel}
              data-testid="sidebar-hamburger"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-60 flex-col p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>{navigationLabel}</SheetTitle>
            </SheetHeader>
            <SidebarContent
              {...rest}
              newChatLabel={newChatLabel}
              newChatAriaLabel={newChatAriaLabel}
              noChatsLabel={noChatsLabel}
              chatSessionsAriaLabel={chatSessionsAriaLabel}
              sessionItemLabels={sessionItemLabels}
            />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
