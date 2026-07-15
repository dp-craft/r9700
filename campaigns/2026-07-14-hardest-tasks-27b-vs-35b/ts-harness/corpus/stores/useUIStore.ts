import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { putAppSetting } from '@/db/appSettings';
import type { SettingsAnchor, SettingsSection } from '@/features/settings';

export type { SettingsAnchor, SettingsSection };

const WORKSPACE_PERSIST_DEBOUNCE_MS = 250;

export type Workspace = 'chat' | 'prompt-lab';
export type ChatPanel = 'conversations' | 'skills';
export type LabPanel = 'tester' | 'run-history' | 'prompt-history' | 'skills';
export type AppDialog = 'settings' | 'skills' | 'prompt-tester' | 'model-info';

const SETTINGS_SECTIONS: ReadonlySet<SettingsSection> = new Set<SettingsSection>([
  'general',
  'api-models',
  'appearance',
  'defaults',
]);

const SETTINGS_ANCHORS: ReadonlySet<SettingsAnchor> = new Set<SettingsAnchor>([
  'chat-defaults',
  'lab-defaults',
  'lab-retention',
]);

export interface SettingsDialogPayload {
  readonly section?: SettingsSection;
  readonly anchor?: SettingsAnchor;
}

export function isSettingsDialogPayload(value: unknown): value is SettingsDialogPayload {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  const section = obj.section;
  if (section !== undefined) {
    if (typeof section !== 'string' || !SETTINGS_SECTIONS.has(section as SettingsSection))
      return false;
  }
  const anchor = obj.anchor;
  if (anchor !== undefined) {
    if (typeof anchor !== 'string' || !SETTINGS_ANCHORS.has(anchor as SettingsAnchor)) return false;
  }
  return true;
}

export interface DialogPayload {
  readonly tab?: string;
  readonly section?: string;
  readonly anchor?: string;
}

export interface UIState {
  readonly workspace: Workspace;
  readonly chatPanel: ChatPanel;
  readonly labPanel: LabPanel;
  readonly activeDialog: AppDialog | null;
  readonly dialogPayload: DialogPayload | null;
  readonly chatInputPrefill: string | null;
  readonly mfError: Error | null;
  readonly pendingLabRunId: string | null;
  readonly inFlightCalls: number;
  setWorkspace: (ws: Workspace) => void;
  setChatPanel: (panel: ChatPanel) => void;
  setLabPanel: (panel: LabPanel) => void;
  requestWorkspacePanel: (ws: Workspace, panel: ChatPanel | LabPanel) => void;
  openDialog: (dialog: AppDialog, payload?: DialogPayload) => void;
  closeDialog: () => void;
  setChatInputPrefill: (text: string | null) => void;
  setMfError: (error: Error | null) => void;
  setPendingLabRunId: (id: string | null) => void;
  beginInFlightCall: () => void;
  endInFlightCall: () => void;
}

export const sanitizeWorkspace = (value: unknown): Workspace => {
  if (value === 'chat' || value === 'prompt-lab') return value;
  return 'chat';
};

export const useUIStore = create<UIState>()(
  subscribeWithSelector(set => ({
    workspace: 'chat' as const,
    chatPanel: 'conversations' as const,
    labPanel: 'tester' as const,
    activeDialog: null,
    dialogPayload: null,
    chatInputPrefill: null,
    mfError: null,
    pendingLabRunId: null,
    inFlightCalls: 0,
    setWorkspace: (ws: Workspace): void => {
      set({ workspace: ws });
    },
    setChatPanel: (panel: ChatPanel): void => {
      set({ chatPanel: panel });
    },
    setLabPanel: (panel: LabPanel): void => {
      set({ labPanel: panel });
    },
    requestWorkspacePanel: (ws: Workspace, panel: ChatPanel | LabPanel): void => {
      set(
        ws === 'chat'
          ? { workspace: ws, chatPanel: panel as ChatPanel }
          : { workspace: ws, labPanel: panel as LabPanel }
      );
    },
    openDialog: (dialog: AppDialog, payload?: DialogPayload): void => {
      set({ activeDialog: dialog, dialogPayload: payload ?? null });
    },
    closeDialog: (): void => {
      set({ activeDialog: null, dialogPayload: null });
    },
    setChatInputPrefill: (text: string | null): void => {
      set({ chatInputPrefill: text });
    },
    setMfError: (error: Error | null): void => {
      set({ mfError: error });
    },
    setPendingLabRunId: (id: string | null): void => {
      set({ pendingLabRunId: id });
    },
    beginInFlightCall: (): void => {
      set(s => ({ inFlightCalls: s.inFlightCalls + 1 }));
    },
    endInFlightCall: (): void => {
      set(s => ({ inFlightCalls: Math.max(0, s.inFlightCalls - 1) }));
    },
  }))
);

export const useDialogPayload = (): DialogPayload | null => useUIStore(s => s.dialogPayload);

let listenerAttached = false;
let debounceHandle: ReturnType<typeof setTimeout> | null = null;

if (!listenerAttached) {
  listenerAttached = true;
  useUIStore.subscribe(
    s => s.workspace,
    workspace => {
      if (debounceHandle !== null) clearTimeout(debounceHandle);
      debounceHandle = setTimeout(() => {
        void putAppSetting('active-page', workspace);
        debounceHandle = null;
      }, WORKSPACE_PERSIST_DEBOUNCE_MS);
    }
  );
}
