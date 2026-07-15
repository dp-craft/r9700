import { useEffect } from 'react';

import { useUIStore } from '@/stores/useUIStore';

export const useGlobalShortcuts = (): void => {
  const setWorkspace = useUIStore(s => s.setWorkspace);
  const openDialog = useUIStore(s => s.openDialog);

  // useEffect: subscribe — document-level keyboard shortcut listener
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.altKey && event.key === '1') {
        event.preventDefault();
        setWorkspace('chat');
        return;
      }
      if (event.altKey && event.key === '2') {
        event.preventDefault();
        setWorkspace('prompt-lab');
        return;
      }
      if (event.ctrlKey && event.key === ',') {
        event.preventDefault();
        if (useUIStore.getState().activeDialog !== 'settings') {
          openDialog('settings');
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [setWorkspace, openDialog]);
};
