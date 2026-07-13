import { HelpCircle } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { SessionSidebarContainer, SidebarFooterContainer } from '@/features/sessions';

export const renderChatRailFooter = (helpLabel: string): ReactNode => (
  <button
    type="button"
    aria-label={helpLabel}
    title={helpLabel}
    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <HelpCircle className="h-4 w-4" aria-hidden="true" />
  </button>
);

export const renderChatRailPanel = (): ReactElement => (
  <SessionSidebarContainer footer={<SidebarFooterContainer />} />
);
