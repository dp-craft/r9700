import type { ReactElement } from 'react';

import { MfLayoutSkeleton } from '@/components/ui/MfLayoutSkeleton';
import { useTranslation } from '@/i18n';
import { MFRail, SkillsPanelContainer, useMFRailItems } from '@/shell';
import { useUIStore } from '@/stores/useUIStore';

import { ChatHeaderContainer } from './ChatHeaderContainer';
import { renderChatRailFooter, renderChatRailPanel } from './chatShellHelpers';
import { ChatWindowContainer } from './ChatWindowContainer';

interface ConversationsPanelLabels {
  readonly sessionListAria: string;
  readonly conversationAria: string;
}

const renderConversationsPanel = (labels: ConversationsPanelLabels): ReactElement => (
  <MfLayoutSkeleton
    headerSlot={<ChatHeaderContainer />}
    leftColumnSlot={renderChatRailPanel()}
    rightColumnSlot={<ChatWindowContainer />}
    leftColumnAriaLabel={labels.sessionListAria}
    rightColumnAriaLabel={labels.conversationAria}
  />
);

const renderPanelBody = (panel: string, labels: ConversationsPanelLabels): ReactElement =>
  panel === 'skills' ? <SkillsPanelContainer /> : renderConversationsPanel(labels);

export function ChatShellContainer(): ReactElement {
  const t = useTranslation();
  const rail = useMFRailItems();
  const chatPanel = useUIStore(s => s.chatPanel);

  const handlePanelChange = (key: string): void => {
    rail.onSelect(key);
  };

  const labels: ConversationsPanelLabels = {
    sessionListAria: t('chat.layout.sessionListAria'),
    conversationAria: t('chat.layout.conversationAria'),
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0">
        <MFRail
          items={rail.items}
          activePanelKey={rail.activePanelKey}
          onPanelChange={handlePanelChange}
          footerSlot={renderChatRailFooter(t('shell.rail.help'))}
        />
        {renderPanelBody(chatPanel, labels)}
      </div>
    </div>
  );
}
