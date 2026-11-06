import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUIStore } from '../useUIStore';

vi.mock('@/db/appSettings', () => ({ putAppSetting: vi.fn() }));

const INITIAL_INFLIGHT = 0;

const resetStore = (): void => {
  useUIStore.setState({ inFlightCalls: INITIAL_INFLIGHT });
};

describe('useUIStore — inFlightCalls counter', () => {
  beforeEach(() => {
    resetStore();
  });

  it('should increment to 2 then return to baseline after parallel begin/begin/end/end', () => {
    const { beginInFlightCall, endInFlightCall } = useUIStore.getState();

    // Arrange: two concurrent begins
    beginInFlightCall();
    beginInFlightCall();

    // Assert mid-flight
    expect(useUIStore.getState().inFlightCalls).toBe(2);

    // Act: two ends (interleaved finish)
    endInFlightCall();
    endInFlightCall();

    // Assert: back to baseline
    expect(useUIStore.getState().inFlightCalls).toBe(INITIAL_INFLIGHT);
  });

  it('should restore inFlightCalls to baseline when a tracked async operation rejects (R-028 finally semantics)', async () => {
    const { beginInFlightCall, endInFlightCall } = useUIStore.getState();

    const trackedAsync = async (): Promise<void> => {
      beginInFlightCall();
      try {
        await Promise.reject(new Error('LLM call failed'));
      } finally {
        endInFlightCall();
      }
    };

    // Act: drive the operation and swallow the rejection
    await trackedAsync().catch(() => undefined);

    // Assert: counter is back to baseline despite rejection
    expect(useUIStore.getState().inFlightCalls).toBe(INITIAL_INFLIGHT);
  });
});
