import type { LucideIcon } from 'lucide-react';

import type { ChatPanel, LabPanel, Workspace } from '@/stores/useUIStore';

export interface MFInnerRailItem {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly labelKey: string;
  readonly panelKey: ChatPanel | LabPanel;
  readonly badge?: number | string;
  readonly disabled?: boolean;
}

export interface MFMeta {
  readonly id: Workspace;
  readonly labelKey: string;
  readonly accentColor: 'blue' | 'purple' | 'green' | 'amber' | 'orange';
  readonly icon: LucideIcon;
}
