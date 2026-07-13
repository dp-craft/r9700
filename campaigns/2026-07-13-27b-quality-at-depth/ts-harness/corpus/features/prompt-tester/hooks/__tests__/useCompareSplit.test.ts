import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { useCompareSplit } from '../useCompareSplit';

const CONTAINER_TOP = 100;
const CONTAINER_HEIGHT = 400;

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  container.getBoundingClientRect = (): DOMRect =>
    ({ top: CONTAINER_TOP, height: CONTAINER_HEIGHT }) as DOMRect;
  return container;
}

const DRAG_START_CLIENT_Y = 300;

function makeResizeStartEvent(clientY: number = DRAG_START_CLIENT_Y): {
  currentTarget: HTMLElement;
  clientY: number;
} {
  const container = makeContainer();
  const handle = document.createElement('div');
  container.appendChild(handle);
  return { currentTarget: handle, clientY };
}

function dispatchPointerMove(clientY: number): void {
  const event = new Event('pointermove') as Event & { clientY: number };
  event.clientY = clientY;
  window.dispatchEvent(event);
}

function dispatchPointerUp(): void {
  window.dispatchEvent(new Event('pointerup'));
}

describe('useCompareSplit', () => {
  beforeEach(() => {
    usePromptTesterStore.getState().setCompareSplitRatio(0.5);
  });

  afterEach(() => {
    dispatchPointerUp();
  });

  it('should mirror the store compareSplitRatio when read', () => {
    act(() => {
      usePromptTesterStore.getState().setCompareSplitRatio(0.6);
    });

    const { result } = renderHook(() => useCompareSplit());

    expect(result.current.ratio).toBe(0.6);
  });

  it('should commit a ratio derived from the pointer delta over container height on move', () => {
    const { result } = renderHook(() => useCompareSplit());

    act(() => {
      result.current.onResizeStart(makeResizeStartEvent() as unknown as React.PointerEvent);
    });

    // Pointer at the drag-start anchor (300) -> delta 0 -> ratio stays 0.5.
    act(() => {
      dispatchPointerMove(300);
    });

    expect(usePromptTesterStore.getState().compareSplitRatio).toBe(0.5);

    // Pointer travels -60px -> 0.5 + (240 - 300) / 400 = 0.35.
    act(() => {
      dispatchPointerMove(240);
    });

    expect(usePromptTesterStore.getState().compareSplitRatio).toBeCloseTo(0.35, 5);
  });

  it('should move the divider by the pointer delta from drag start, not snap to absolute clientY', () => {
    act(() => {
      usePromptTesterStore.getState().setCompareSplitRatio(0.3);
    });

    const { result } = renderHook(() => useCompareSplit());

    act(() => {
      result.current.onResizeStart(makeResizeStartEvent() as unknown as React.PointerEvent);
    });

    // Pointer at the pointerdown anchor (300) -> delta 0 -> ratio stays at 0.3.
    act(() => {
      dispatchPointerMove(300);
    });
    expect(usePromptTesterStore.getState().compareSplitRatio).toBeCloseTo(0.3, 5);

    // Pointer travels +40px -> 0.3 + 40/400 = 0.4 (absolute mapping would give (340-100)/400 = 0.6).
    act(() => {
      dispatchPointerMove(340);
    });
    expect(usePromptTesterStore.getState().compareSplitRatio).toBeCloseTo(0.4, 5);
  });

  it('should clamp the committed ratio to the store min when dragged near the top', () => {
    const { result } = renderHook(() => useCompareSplit());

    act(() => {
      result.current.onResizeStart(makeResizeStartEvent() as unknown as React.PointerEvent);
    });

    // Pointer at the pointerdown anchor (300) -> delta 0 -> ratio stays 0.5.
    act(() => {
      dispatchPointerMove(300);
    });

    // Drag far up: 0.5 + (100 - 300) / 400 = 0, clamped to store min 0.15.
    act(() => {
      dispatchPointerMove(100);
    });

    expect(usePromptTesterStore.getState().compareSplitRatio).toBe(0.15);
  });

  it('should stop committing after pointerup removes the listeners', () => {
    const { result } = renderHook(() => useCompareSplit());

    act(() => {
      result.current.onResizeStart(makeResizeStartEvent() as unknown as React.PointerEvent);
    });

    act(() => {
      dispatchPointerMove(300);
    });
    expect(usePromptTesterStore.getState().compareSplitRatio).toBe(0.5);

    act(() => {
      dispatchPointerUp();
    });

    // A move after pointerup must not change the ratio
    act(() => {
      dispatchPointerMove(240);
    });

    expect(usePromptTesterStore.getState().compareSplitRatio).toBe(0.5);
  });
});
