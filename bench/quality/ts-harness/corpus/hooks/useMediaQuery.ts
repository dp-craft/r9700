import { useCallback, useSyncExternalStore } from 'react';

const getServerSnapshot = (): boolean => false;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void): (() => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', callback);
      return (): void => {
        mql.removeEventListener('change', callback);
      };
    },
    [query]
  );

  const getSnapshot = useCallback((): boolean => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
