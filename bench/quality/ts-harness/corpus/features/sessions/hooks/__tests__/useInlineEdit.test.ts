import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '../../stores/useSessionStore';
import { useInlineEdit } from '../useInlineEdit';

const KEY = 'session-1';

describe('useInlineEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ editingSessionId: null });
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  it('should start in non-editing mode with empty editValue when store key is null', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    expect(result.current.isEditing).toBe(false);
    expect(result.current.editValue).toBe('');
  });

  it('should reflect isEditing=true when editingSessionId matches key', () => {
    useSessionStore.setState({ editingSessionId: KEY });
    const { result } = renderHook(() => useInlineEdit(KEY));

    expect(result.current.isEditing).toBe(true);
  });

  it('should reflect isEditing=false when editingSessionId differs from key', () => {
    useSessionStore.setState({ editingSessionId: 'other' });
    const { result } = renderHook(() => useInlineEdit(KEY));

    expect(result.current.isEditing).toBe(false);
  });

  // =========================================================================
  // startEditing
  // =========================================================================

  it('should enter edit mode with current name when startEditing is called', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    act(() => {
      result.current.startEditing('My Chat');
    });

    expect(result.current.isEditing).toBe(true);
    expect(result.current.editValue).toBe('My Chat');
    expect(useSessionStore.getState().editingSessionId).toBe(KEY);
  });

  // =========================================================================
  // setEditValue
  // =========================================================================

  it('should update edit value when setEditValue is called', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    act(() => {
      result.current.startEditing('Original');
    });

    act(() => {
      result.current.setEditValue('New Name');
    });

    expect(result.current.editValue).toBe('New Name');
  });

  // =========================================================================
  // confirmEdit
  // =========================================================================

  it('should return trimmed value and exit edit mode when confirmEdit is called with valid input', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    act(() => {
      result.current.startEditing('Old Name');
    });

    act(() => {
      result.current.setEditValue(' New Name ');
    });

    let returnValue: string | null = null;
    act(() => {
      returnValue = result.current.confirmEdit();
    });

    expect(returnValue).toBe('New Name');
    expect(result.current.isEditing).toBe(false);
    expect(useSessionStore.getState().editingSessionId).toBeNull();
  });

  it('should return null and not exit edit mode when confirmEdit is called with whitespace-only input', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    act(() => {
      result.current.startEditing('Old Name');
    });

    act(() => {
      result.current.setEditValue('   ');
    });

    let returnValue: string | null = null;
    act(() => {
      returnValue = result.current.confirmEdit();
    });

    expect(returnValue).toBeNull();
  });

  // =========================================================================
  // cancelEdit
  // =========================================================================

  it('should exit edit mode and reset editValue when cancelEdit is called', () => {
    const { result } = renderHook(() => useInlineEdit(KEY));

    act(() => {
      result.current.startEditing('Original');
    });

    act(() => {
      result.current.setEditValue('Changed');
    });

    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.isEditing).toBe(false);
    expect(result.current.editValue).toBe('');
    expect(useSessionStore.getState().editingSessionId).toBeNull();
  });
});
