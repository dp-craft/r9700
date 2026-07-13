import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetPwaInstallForTests, usePwaInstall } from './usePwaInstall';

describe('usePwaInstall', () => {
  // -- Setup and teardown --

  beforeEach(() => {
    vi.clearAllMocks();
    __resetPwaInstallForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- Initial state --

  it('should initialize with canInstall set to false', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.canInstall).toBe(false);
  });

  it('should return promptInstall function in initial state', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(typeof result.current.promptInstall).toBe('function');
  });

  it('should have promptInstall callable without errors when canInstall is false', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(() => {
      result.current.promptInstall();
    }).not.toThrow();
  });

  // -- beforeinstallprompt event listening --

  it('should listen for beforeinstallprompt event on mount', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    renderHook(() => usePwaInstall());

    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
  });

  it('should set canInstall to true when beforeinstallprompt event fires', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.canInstall).toBe(false);

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('should store the beforeinstallprompt event for later use', () => {
    const { result } = renderHook(() => usePwaInstall());

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);
    expect(typeof result.current.promptInstall).toBe('function');
  });

  // -- promptInstall functionality --

  it('should call prompt() on the stored event when promptInstall is called', async () => {
    const { result } = renderHook(() => usePwaInstall());

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(mockPrompt.prompt).toHaveBeenCalledOnce();
  });

  it('should return userChoice promise when promptInstall is called with available prompt', async () => {
    const { result } = renderHook(() => usePwaInstall());

    const mockUserChoice = Promise.resolve({ outcome: 'accepted' as const });
    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: mockUserChoice,
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    let promptResult: unknown;
    await act(async () => {
      promptResult = result.current.promptInstall();
    });

    expect(promptResult).toBe(mockUserChoice);
  });

  it('should handle promptInstall gracefully when no prompt is available', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.canInstall).toBe(false);

    expect(() => {
      result.current.promptInstall();
    }).not.toThrow();
  });

  it('should return undefined when promptInstall is called without an available prompt', () => {
    const { result } = renderHook(() => usePwaInstall());

    const promptResult = result.current.promptInstall();

    expect(promptResult).toBeUndefined();
  });

  // -- Event listener cleanup --

  it('should remove beforeinstallprompt event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => usePwaInstall());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeinstallprompt',
      expect.any(Function)
    );
  });

  it('should not respond to beforeinstallprompt after unmount', () => {
    const { result, unmount } = renderHook(() => usePwaInstall());

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);

    unmount();

    const anotherMockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event2 = new Event('beforeinstallprompt');
      Object.assign(event2, anotherMockPrompt);
      window.dispatchEvent(event2);
    });

    expect(anotherMockPrompt.prompt).not.toHaveBeenCalled();
  });

  // -- Return type contract --

  it('should return an object with canInstall boolean and promptInstall function', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current).toHaveProperty('canInstall');
    expect(result.current).toHaveProperty('promptInstall');
    expect(typeof result.current.canInstall).toBe('boolean');
    expect(typeof result.current.promptInstall).toBe('function');
  });

  // -- Multiple events --

  it('should update canInstall if a second beforeinstallprompt event fires', () => {
    const { result } = renderHook(() => usePwaInstall());

    const firstMockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, firstMockPrompt);
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);

    const secondMockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    };

    act(() => {
      const event2 = new Event('beforeinstallprompt');
      Object.assign(event2, secondMockPrompt);
      window.dispatchEvent(event2);
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('should use the latest prompt when promptInstall is called after multiple events', async () => {
    const { result } = renderHook(() => usePwaInstall());

    const firstMockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, firstMockPrompt);
      window.dispatchEvent(event);
    });

    const secondMockPrompt = {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
    };

    act(() => {
      const event2 = new Event('beforeinstallprompt');
      Object.assign(event2, secondMockPrompt);
      window.dispatchEvent(event2);
    });

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(firstMockPrompt.prompt).not.toHaveBeenCalled();
    expect(secondMockPrompt.prompt).toHaveBeenCalledOnce();
  });

  // -- Edge cases --

  it('should handle null event target gracefully', () => {
    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.canInstall).toBe(false);

    act(() => {
      const event = new Event('beforeinstallprompt');
      window.dispatchEvent(event);
    });

    expect(() => {
      result.current.promptInstall();
    }).not.toThrow();
  });

  it('should handle event with missing prompt method gracefully', () => {
    const { result } = renderHook(() => usePwaInstall());

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, { userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
      window.dispatchEvent(event);
    });

    expect(() => {
      result.current.promptInstall();
    }).not.toThrow();
  });

  it('should handle promptInstall rejection gracefully', async () => {
    const { result } = renderHook(() => usePwaInstall());

    const userChoicePromise = Promise.reject(new Error('Installation failed'));
    userChoicePromise.catch(() => {});

    const mockPrompt = {
      prompt: vi.fn(),
      userChoice: userChoicePromise,
    };

    act(() => {
      const event = new Event('beforeinstallprompt');
      Object.assign(event, mockPrompt);
      window.dispatchEvent(event);
    });

    let promptResult: unknown;
    await act(async () => {
      promptResult = result.current.promptInstall();
    });

    expect(promptResult).toBeDefined();

    await expect(promptResult).rejects.toThrow('Installation failed');
  });
});
