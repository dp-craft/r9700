import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UsePwaInstallReturn {
  readonly canInstall: boolean;
  readonly promptInstall: () => Promise<{ outcome: 'accepted' | 'dismissed' }> | undefined;
}

let installPromptEvent: BeforeInstallPromptEvent | null = null;
const listeners: Set<() => void> = new Set<() => void>();

function handleBeforeInstallPrompt(event: Event): void {
  installPromptEvent = event as BeforeInstallPromptEvent;
  listeners.forEach(fn => {
    fn();
  });
}

function subscribe(callback: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }
  listeners.add(callback);
  return (): void => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }
  };
}

function getSnapshot(): boolean {
  return installPromptEvent !== null;
}

function getServerSnapshot(): boolean {
  return false;
}

function promptInstall(): Promise<{ outcome: 'accepted' | 'dismissed' }> | undefined {
  const prompt = installPromptEvent;
  if (!prompt || typeof prompt.prompt !== 'function') {
    return undefined;
  }
  void prompt.prompt();
  return prompt.userChoice;
}

export function usePwaInstall(): UsePwaInstallReturn {
  const canInstall = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { canInstall, promptInstall };
}

/**
 * Test-only helper to reset module-level state between tests.
 * MUST NOT be called from application code.
 */
export function __resetPwaInstallForTests(): void {
  installPromptEvent = null;
  listeners.clear();
}
