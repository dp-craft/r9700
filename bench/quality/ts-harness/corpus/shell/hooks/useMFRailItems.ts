import type { LucideIcon } from 'lucide-react';
import { FileText, FlaskConical, History, MessageSquare, Puzzle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useTranslation } from '@/i18n';
import { type ChatPanel, type LabPanel, useUIStore } from '@/stores/useUIStore';

import type { MFInnerRailItem } from '../types';

export interface MFRailData {
  readonly items: readonly MFInnerRailItem[];
  readonly activePanelKey: ChatPanel | LabPanel;
  readonly onSelect: (panelKey: string) => void;
}

interface RailItemDefBase {
  readonly id: string;
  readonly icon: LucideIcon;
  readonly labelKey: string;
}

interface ChatRailItemDef extends RailItemDefBase {
  readonly panelKey: ChatPanel;
}

interface LabRailItemDef extends RailItemDefBase {
  readonly panelKey: LabPanel;
}

type RailItemDef = ChatRailItemDef | LabRailItemDef;

const CHAT_ITEM_DEFS: readonly ChatRailItemDef[] = [
  {
    id: 'chat-conversations',
    icon: MessageSquare,
    labelKey: 'shell.chat.rail.conversations',
    panelKey: 'conversations',
  },
  { id: 'chat-skills', icon: Puzzle, labelKey: 'shell.rail.skills', panelKey: 'skills' },
];

const LAB_ITEM_DEFS: readonly LabRailItemDef[] = [
  { id: 'lab-tester', icon: FlaskConical, labelKey: 'shell.lab.rail.tester', panelKey: 'tester' },
  {
    id: 'lab-run-history',
    icon: History,
    labelKey: 'shell.mf.label.run-history',
    panelKey: 'run-history',
  },
  {
    id: 'lab-prompt-history',
    icon: FileText,
    labelKey: 'shell.mf.label.prompt-history',
    panelKey: 'prompt-history',
  },
  { id: 'lab-skills', icon: Puzzle, labelKey: 'shell.rail.skills', panelKey: 'skills' },
];

const toRailItem =
  (t: (key: string) => string) =>
    (def: RailItemDef): MFInnerRailItem => ({
      id: def.id,
      icon: def.icon,
      labelKey: t(def.labelKey),
      panelKey: def.panelKey,
    });

const chatPanelOf = (k: string): ChatPanel | undefined =>
  CHAT_ITEM_DEFS.find(d => d.panelKey === k)?.panelKey;

const labPanelOf = (k: string): LabPanel | undefined =>
  LAB_ITEM_DEFS.find(d => d.panelKey === k)?.panelKey;

export const useMFRailItems = (): MFRailData => {
  const { workspace, chatPanel, labPanel, setChatPanel, setLabPanel } = useUIStore(
    useShallow(s => ({
      workspace: s.workspace,
      chatPanel: s.chatPanel,
      labPanel: s.labPanel,
      setChatPanel: s.setChatPanel,
      setLabPanel: s.setLabPanel,
    }))
  );
  const t = useTranslation();

  const isChat = workspace === 'chat';
  const defs = isChat ? CHAT_ITEM_DEFS : LAB_ITEM_DEFS;

  const onSelect = (panelKey: string): void => {
    if (isChat) {
      const p = chatPanelOf(panelKey);
      if (p) setChatPanel(p);
      return;
    }
    const p = labPanelOf(panelKey);
    if (p) setLabPanel(p);
  };

  return {
    items: defs.map(toRailItem(t)),
    activePanelKey: isChat ? chatPanel : labPanel,
    onSelect,
  };
};
