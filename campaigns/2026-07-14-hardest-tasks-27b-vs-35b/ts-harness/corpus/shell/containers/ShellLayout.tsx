import type { ReactElement } from 'react';

import { ChatShellContainer } from '@/features/chat';
import { PromptLabShellContainer } from '@/features/prompt-tester';
import { SettingsDialog } from '@/features/settings';
import { useUIStore } from '@/stores/useUIStore';

import { MFErrorBoundary } from '../components/MFErrorBoundary';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { HostBarContainer } from './HostBarContainer';

const renderMfFallback = (error: Error): ReactElement => (
  <div className="flex flex-1 items-center justify-center p-8">
    <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
      <p className="text-sm font-medium text-destructive">{error.message}</p>
    </div>
  </div>
);

const buildSettingsOpenChange =
  (closeDialog: () => void) =>
    (open: boolean): void => {
      if (!open) {
        closeDialog();
      }
    };

export function ShellLayout(): ReactElement {
  useGlobalShortcuts();

  const workspace = useUIStore(s => s.workspace);
  const activeDialog = useUIStore(s => s.activeDialog);
  const setMfError = useUIStore(s => s.setMfError);
  const closeDialog = useUIStore(s => s.closeDialog);

  const handleSettingsOpenChange = buildSettingsOpenChange(closeDialog);

  return (
    <>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <HostBarContainer />
        <div className="flex flex-1 flex-col overflow-hidden">
          <MFErrorBoundary
            resetKey={workspace}
            onError={setMfError}
            fallbackRender={renderMfFallback}
          >
            {workspace === 'chat' && <ChatShellContainer key="chat" />}
            {workspace === 'prompt-lab' && <PromptLabShellContainer key="prompt-lab" />}
          </MFErrorBoundary>
        </div>
      </div>
      <SettingsDialog open={activeDialog === 'settings'} onOpenChange={handleSettingsOpenChange} />
    </>
  );
}
