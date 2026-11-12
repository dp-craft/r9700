import { useMemo } from 'react';

import { useTranslation } from '@/i18n';

import type { SessionItemLabels } from '../components/SessionItem';

interface SessionLabels {
  readonly newChatLabel: string;
  readonly newChatAriaLabel: string;
  readonly openSidebarLabel: string;
  readonly navigationLabel: string;
  readonly noChatsLabel: string;
  readonly chatSessionsAriaLabel: string;
  readonly sessionItemLabels: SessionItemLabels;
}

export function useSessionLabels(): SessionLabels {
  const t = useTranslation();

  return useMemo(
    (): SessionLabels => ({
      newChatLabel: t('sessions.newChat'),
      newChatAriaLabel: t('sessions.newChatAria'),
      openSidebarLabel: t('sessions.openSidebar'),
      navigationLabel: t('sessions.navigation'),
      noChatsLabel: t('sessions.noChats'),
      chatSessionsAriaLabel: t('sessions.chatSessions'),
      sessionItemLabels: {
        selectChatAriaPrefix: t('sessions.selectChat', { title: '' }).replace(/\s*$/, ''),
        deleteChatAriaLabel: t('sessions.deleteChat'),
        deleteDialogTitle: t('sessions.deleteTitle'),
        deleteDialogDescription: t('sessions.deleteDescription'),
        cancelLabel: t('common.cancel'),
        deleteLabel: t('common.delete'),
      },
    }),
    [t]
  );
}
