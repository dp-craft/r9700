export type StreamOrigin = 'chat' | 'lab';

export interface BackgroundStreamEntry {
  readonly id: string;
  readonly origin: StreamOrigin;
  readonly label: string;
  readonly startedAt: number;
  readonly abort: () => void;
}

export interface BackgroundStreamView {
  readonly id: string;
  readonly origin: StreamOrigin;
  readonly label: string;
  readonly startedAt: number;
}

export interface StreamRegistry {
  register(entry: BackgroundStreamEntry): void;
  unregister(id: string): void;
  list(): readonly BackgroundStreamView[];
  abort(id: string): void;
  subscribe(listener: () => void): () => void;
}

const toView = (entry: BackgroundStreamEntry): BackgroundStreamView => ({
  id: entry.id,
  origin: entry.origin,
  label: entry.label,
  startedAt: entry.startedAt,
});

export const createStreamRegistry = (): StreamRegistry => {
  const entries = new Map<string, BackgroundStreamEntry>();
  const listeners = new Set<() => void>();
  let cachedList: readonly BackgroundStreamView[] | null = null;

  const notify = (): void => {
    listeners.forEach(fn => {
      fn();
    });
  };

  const invalidate = (): void => {
    cachedList = null;
  };

  const register = (entry: BackgroundStreamEntry): void => {
    entries.set(entry.id, entry);
    invalidate();
    notify();
  };

  const unregister = (id: string): void => {
    if (!entries.has(id)) return;
    entries.delete(id);
    invalidate();
    notify();
  };

  const list = (): readonly BackgroundStreamView[] => {
    if (cachedList === null) {
      cachedList = [...entries.values()].map(toView);
    }
    return cachedList;
  };

  const abort = (id: string): void => {
    entries.get(id)?.abort();
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { register, unregister, list, abort, subscribe };
};

export const streamRegistry: StreamRegistry = createStreamRegistry();
