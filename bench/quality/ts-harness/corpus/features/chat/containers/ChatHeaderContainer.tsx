import type * as React from 'react';

import { useTranslation } from '@/i18n';
import { useUIStore } from '@/stores/useUIStore';

import { ChatHeader } from '../components/ChatHeader';

export interface ChatHeaderContainerProps {
  readonly className?: string;
}

export function ChatHeaderContainer({ className }: ChatHeaderContainerProps): React.ReactElement {
  const t = useTranslation();
  const inFlightCalls = useUIStore(s => s.inFlightCalls);

  const badgesSlot =
    inFlightCalls > 0 ? (
      <output
        data-testid="bg-call-counter"
        aria-label={t('chat.header.backgroundCalls')}
        className="border-accent/40 bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      >
        <span
          aria-hidden="true"
          className="border-accent/30 border-t-accent h-3 w-3 animate-spin rounded-full border-2"
        />
        <span>{inFlightCalls}</span>
      </output>
    ) : undefined;

  return <ChatHeader badgesSlot={badgesSlot} className={className} />;
}
