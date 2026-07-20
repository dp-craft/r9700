import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type BackgroundStreamEntry,
  createStreamRegistry,
  type StreamRegistry
} from '@/services/streaming/streamRegistry';

const makeEntry = (overrides: Partial<BackgroundStreamEntry> = {}): BackgroundStreamEntry => ({
  id: 'entry-1',
  origin: 'chat',
  label: 'Test stream',
  startedAt: 1000,
  abort: vi.fn(),
  ...overrides,
});

describe('createStreamRegistry', () => {
  let registry: StreamRegistry;

  beforeEach(() => {
    registry = createStreamRegistry();
  });

  it('should return empty array when list() called initially', () => {
    expect(registry.list()).toEqual([]);
  });

  it('should add entry visible via list() when register called', () => {
    const entry = makeEntry({ id: 'a1' });
    registry.register(entry);
    const views = registry.list();
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe('a1');
    expect(views[0].label).toBe('Test stream');
    expect(views[0].origin).toBe('chat');
    expect(views[0].startedAt).toBe(1000);
  });

  it('should strip abort field from view when register called', () => {
    registry.register(makeEntry());
    const view = registry.list()[0];
    expect('abort' in view).toBe(false);
  });

  it('should remove entry by id when unregister called', () => {
    registry.register(makeEntry({ id: 'r1' }));
    registry.unregister('r1');
    expect(registry.list()).toHaveLength(0);
  });

  it('should be idempotent when unregister called with unknown id', () => {
    registry.register(makeEntry({ id: 'r1' }));
    registry.unregister('unknown');
    expect(registry.list()).toHaveLength(1);
  });

  it('should return stable ref when list() called without changes', () => {
    registry.register(makeEntry());
    const first = registry.list();
    const second = registry.list();
    expect(first).toBe(second);
  });

  it('should return new ref after register', () => {
    registry.register(makeEntry({ id: 'a' }));
    const first = registry.list();
    registry.register(makeEntry({ id: 'b' }));
    const second = registry.list();
    expect(first).not.toBe(second);
  });

  it('should return new ref after unregister', () => {
    registry.register(makeEntry({ id: 'a' }));
    const first = registry.list();
    registry.unregister('a');
    const second = registry.list();
    expect(first).not.toBe(second);
  });

  it('should call entry abort callback when abort called with matching id', () => {
    const abortFn = vi.fn();
    registry.register(makeEntry({ id: 'x1', abort: abortFn }));
    registry.abort('x1');
    expect(abortFn).toHaveBeenCalledOnce();
  });

  it('should be no-op when abort called with unknown id', () => {
    const abortFn = vi.fn();
    registry.register(makeEntry({ id: 'x1', abort: abortFn }));
    expect(() => registry.abort('unknown')).not.toThrow();
    expect(abortFn).not.toHaveBeenCalled();
  });

  it('should notify listener when register called', () => {
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(makeEntry());
    expect(listener).toHaveBeenCalledOnce();
  });

  it('should notify listener when unregister called', () => {
    const listener = vi.fn();
    registry.register(makeEntry({ id: 'r1' }));
    registry.subscribe(listener);
    registry.unregister('r1');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('should stop notifications after unsubscribe called', () => {
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    unsubscribe();
    registry.register(makeEntry());
    expect(listener).not.toHaveBeenCalled();
  });

  it('should notify all listeners when register called with multiple subscribers', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    registry.subscribe(listenerA);
    registry.subscribe(listenerB);
    registry.register(makeEntry());
    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
  });
});
