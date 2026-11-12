import { useEffect, useRef } from 'react';

export function useScrollToBottom<T extends HTMLElement>(
  _dependency: unknown
): React.RefObject<T | null> {
  const bottomRef = useRef<T | null>(null);

  // useEffect: dom-imperative — scrolls bottom sentinel into view on mount
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  return bottomRef;
}
