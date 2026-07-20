import type React from 'react';
import { useSyncExternalStore } from 'react';

import { streamRegistry } from '@/services/streaming/streamRegistry';

import type { BackgroundStreamItemVM } from '../components/BackgroundStreamIndicator';
import { BackgroundStreamIndicator } from '../components/BackgroundStreamIndicator';

const handleStop = (id: string): void => {
  streamRegistry.abort(id);
};

const BackgroundStreamIndicatorContainer = (): React.ReactElement | null => {
  const items: readonly BackgroundStreamItemVM[] = useSyncExternalStore(
    streamRegistry.subscribe,
    streamRegistry.list
  );

  if (items.length === 0) {
    return null;
  }

  return <BackgroundStreamIndicator items={items} onStop={handleStop} />;
};

export { BackgroundStreamIndicatorContainer };
