// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('@/services/streaming/streamRegistry', () => ({
  streamRegistry: {
    subscribe: vi.fn(),
    list: vi.fn(),
    abort: vi.fn(),
  },
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamRegistry } from '@/services/streaming/streamRegistry';
import { ariaTree } from '@/test/serializers/aria-tree';

import { BackgroundStreamIndicatorContainer } from '../BackgroundStreamIndicatorContainer';

const mockSubscribe = vi.mocked(streamRegistry.subscribe);
const mockList = vi.mocked(streamRegistry.list);

describe('BackgroundStreamIndicatorContainer — L3 smoke', () => {
  beforeEach(() => {
    mockSubscribe.mockClear();
    mockList.mockClear();
    mockSubscribe.mockReturnValue(() => undefined);
  });

  it('should render null when streamRegistry has no active streams', () => {
    mockList.mockReturnValue([]);
    const { container } = render(<BackgroundStreamIndicatorContainer />);
    expect(ariaTree(container)).toMatchInlineSnapshot(`""`);
  });

  it('should render indicator with items from streamRegistry', () => {
    mockList.mockReturnValue([
      { id: 'stream-1', origin: 'chat', label: 'Chat stream', startedAt: 1000 },
      { id: 'stream-2', origin: 'lab', label: 'Lab stream', startedAt: 2000 },
    ]);
    render(<BackgroundStreamIndicatorContainer />);
    expect(screen.getByRole('button', { name: '2 active streams' })).toBeDefined();
  });

  it('should subscribe to streamRegistry via useSyncExternalStore', () => {
    mockList.mockReturnValue([]);
    render(<BackgroundStreamIndicatorContainer />);
    expect(mockSubscribe).toHaveBeenCalled();
  });
});
