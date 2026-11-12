import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMobile } from '../useMobile';

// -- Mock helpers --

type ChangeHandler = (e: MediaQueryListEvent) => void;

interface MockMediaQueryList {
  matches: boolean;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  readonly _listeners: ChangeHandler[];
}

const createMatchMedia = (matches: boolean): (() => MockMediaQueryList) => {
  const listeners: ChangeHandler[] = [];
  const mql: MockMediaQueryList = {
    matches,
    addEventListener: vi.fn((_event: string, handler: ChangeHandler) => {
      listeners.push(handler);
    }),
    removeEventListener: vi.fn(),
    _listeners: listeners,
  };
  return vi.fn().mockReturnValue(mql);
};

const fireChange = (mql: MockMediaQueryList, matches: boolean): void => {
  mql.matches = matches;
  const event = { matches } as MediaQueryListEvent;
  mql._listeners.forEach(handler => {
    handler(event);
  });
};

// -- Tests --

describe('useMobile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -- Initial state: mobile viewport --

  it('should return isMobile true when viewport is below 768px', () => {
    // Arrange
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMedia(true),
    });

    // Act
    const { result } = renderHook(() => useMobile());

    // Assert
    expect(result.current.isMobile).toBe(true);
  });

  // -- Initial state: desktop viewport --

  it('should return isMobile false when viewport is 768px or above', () => {
    // Arrange
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMedia(false),
    });

    // Act
    const { result } = renderHook(() => useMobile());

    // Assert
    expect(result.current.isMobile).toBe(false);
  });

  // -- matchMedia query string --

  it('should query matchMedia with the max-width 767px breakpoint', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });

    // Act
    renderHook(() => useMobile());

    // Assert
    expect(matchMediaMock).toHaveBeenCalledWith('(max-width: 767px)');
  });

  // -- Reactive update: narrow → wide --

  it('should update isMobile to false when viewport changes from narrow to wide', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(true);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
    const mql = matchMediaMock() as unknown as MockMediaQueryList;

    const { result } = renderHook(() => useMobile());
    expect(result.current.isMobile).toBe(true);

    // Act
    act(() => {
      fireChange(mql, false);
    });

    // Assert
    expect(result.current.isMobile).toBe(false);
  });

  // -- Reactive update: wide → narrow --

  it('should update isMobile to true when viewport changes from wide to narrow', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
    const mql = matchMediaMock() as unknown as MockMediaQueryList;

    const { result } = renderHook(() => useMobile());
    expect(result.current.isMobile).toBe(false);

    // Act
    act(() => {
      fireChange(mql, true);
    });

    // Assert
    expect(result.current.isMobile).toBe(true);
  });

  // -- Event listener registration --

  it('should register a change event listener on mount', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
    const mql = matchMediaMock() as unknown as MockMediaQueryList;

    // Act
    renderHook(() => useMobile());

    // Assert
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  // -- Event listener cleanup --

  it('should remove the change event listener on unmount', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
    const mql = matchMediaMock() as unknown as MockMediaQueryList;

    const { unmount } = renderHook(() => useMobile());

    // Act
    unmount();

    // Assert
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  // -- No further updates after unmount --

  it('should not update state when viewport changes after unmount', () => {
    // Arrange
    const matchMediaMock = createMatchMedia(false);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
    const mql = matchMediaMock() as unknown as MockMediaQueryList;

    const { result, unmount } = renderHook(() => useMobile());
    expect(result.current.isMobile).toBe(false);

    unmount();

    // Act — fire change after unmount; the removed listener must not trigger a state update
    act(() => {
      fireChange(mql, true);
    });

    // Assert — value stays as it was at unmount time
    expect(result.current.isMobile).toBe(false);
  });

  // -- Return type contract --

  it('should return an object with an isMobile boolean property', () => {
    // Arrange
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMedia(false),
    });

    // Act
    const { result } = renderHook(() => useMobile());

    // Assert
    expect(result.current).toHaveProperty('isMobile');
    expect(typeof result.current.isMobile).toBe('boolean');
  });
});
