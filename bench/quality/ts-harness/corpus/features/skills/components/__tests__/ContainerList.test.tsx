import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContainerListItemVM } from '../../types';
import { ContainerList } from '../ContainerList';

// -- Types --

interface ContainerListProps {
  readonly containers: readonly ContainerListItemVM[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly className?: string;
}

// -- Builders --

const buildContainerVM = (overrides?: Partial<ContainerListItemVM>): ContainerListItemVM => ({
  id: 'container-1',
  name: 'Test Container',
  skillCount: 3,
  ...overrides,
});

const buildProps = (overrides?: Partial<ContainerListProps>): ContainerListProps => ({
  containers: [buildContainerVM()],
  selectedId: null,
  onSelect: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContainerList', () => {
  // -- Smoke tests --

  it('should render without crashing with empty containers array', () => {
    const { container } = render(<ContainerList {...buildProps({ containers: [] })} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing with containers', () => {
    const { container } = render(<ContainerList {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render each container name in the list', () => {
    const containers = [
      buildContainerVM({ id: 'c1', name: 'Writing Tools' }),
      buildContainerVM({ id: 'c2', name: 'Code Helpers' }),
      buildContainerVM({ id: 'c3', name: 'Research Kit' }),
    ];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText('Writing Tools')).toBeInTheDocument();
    expect(screen.getByText('Code Helpers')).toBeInTheDocument();
    expect(screen.getByText('Research Kit')).toBeInTheDocument();
  });

  it('should show skill count badge for each container', () => {
    const containers = [
      buildContainerVM({ id: 'c1', name: 'Container A', skillCount: 5 }),
      buildContainerVM({ id: 'c2', name: 'Container B', skillCount: 0 }),
    ];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText(/5 skills/i)).toBeInTheDocument();
    expect(screen.getByText(/0 skills/i)).toBeInTheDocument();
  });

  it('should show singular "skill" when count is 1', () => {
    const containers = [buildContainerVM({ id: 'c1', name: 'Solo Container', skillCount: 1 })];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText(/1 skill\b/i)).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onSelect with container id when a container item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const containers = [buildContainerVM({ id: 'container-abc', name: 'Clickable Container' })];
    render(<ContainerList {...buildProps({ containers, onSelect })} />);

    await user.click(screen.getByText('Clickable Container'));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('container-abc');
  });

  it('should call onSelect with the correct id when multiple containers exist', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const containers = [
      buildContainerVM({ id: 'c1', name: 'First Container' }),
      buildContainerVM({ id: 'c2', name: 'Second Container' }),
      buildContainerVM({ id: 'c3', name: 'Third Container' }),
    ];
    render(<ContainerList {...buildProps({ containers, onSelect })} />);

    await user.click(screen.getByText('Second Container'));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('c2');
  });

  it('should not call onSelect on initial render', () => {
    const onSelect = vi.fn();
    render(<ContainerList {...buildProps({ onSelect })} />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  // -- Selection tests --

  it('should apply selected styling when selectedId matches a container', () => {
    const containers = [
      buildContainerVM({ id: 'c1', name: 'Selected Container' }),
      buildContainerVM({ id: 'c2', name: 'Other Container' }),
    ];
    render(<ContainerList {...buildProps({ containers, selectedId: 'c1' })} />);

    const selectedItem =
      screen.getByText('Selected Container').closest('[data-selected]') ??
      screen.getByText('Selected Container').closest('[aria-selected]') ??
      screen.getByText('Selected Container').closest('[aria-current]');

    expect(selectedItem).toBeTruthy();
  });

  it('should not apply selected styling when selectedId is null', () => {
    const containers = [
      buildContainerVM({ id: 'c1', name: 'Container A' }),
      buildContainerVM({ id: 'c2', name: 'Container B' }),
    ];
    render(<ContainerList {...buildProps({ containers, selectedId: null })} />);

    const selectedItems = document.querySelectorAll(
      '[data-selected="true"], [aria-selected="true"], [aria-current="true"]'
    );

    expect(selectedItems).toHaveLength(0);
  });

  it('should not apply selected styling to non-matching containers', () => {
    const containers = [
      buildContainerVM({ id: 'c1', name: 'Selected Container' }),
      buildContainerVM({ id: 'c2', name: 'Other Container' }),
    ];
    render(<ContainerList {...buildProps({ containers, selectedId: 'c1' })} />);

    const otherItem =
      screen.getByText('Other Container').closest('[data-selected="true"]') ??
      screen.getByText('Other Container').closest('[aria-selected="true"]') ??
      screen.getByText('Other Container').closest('[aria-current="true"]');

    expect(otherItem).toBeNull();
  });

  // -- Edge cases --

  it('should render a large number of containers', () => {
    const containers = Array.from({ length: 50 }, (_, i) =>
      buildContainerVM({ id: `c${i}`, name: `Container ${i}`, skillCount: i })
    );
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText('Container 0')).toBeInTheDocument();
    expect(screen.getByText('Container 49')).toBeInTheDocument();
  });

  it('should handle container with very long name', () => {
    const longName = 'A'.repeat(200);
    const containers = [buildContainerVM({ id: 'c1', name: longName })];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it('should handle selectedId that does not match any container', () => {
    const containers = [buildContainerVM({ id: 'c1', name: 'Existing Container' })];
    const { container } = render(
      <ContainerList {...buildProps({ containers, selectedId: 'nonexistent-id' })} />
    );

    expect(container).toBeTruthy();
    expect(screen.getByText('Existing Container')).toBeInTheDocument();
  });

  it('should handle container with zero skill count', () => {
    const containers = [buildContainerVM({ id: 'c1', name: 'Empty Container', skillCount: 0 })];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText('Empty Container')).toBeInTheDocument();
    expect(screen.getByText(/0 skills/i)).toBeInTheDocument();
  });

  it('should handle container with large skill count', () => {
    const containers = [buildContainerVM({ id: 'c1', name: 'Big Container', skillCount: 999 })];
    render(<ContainerList {...buildProps({ containers })} />);

    expect(screen.getByText(/999 skills/i)).toBeInTheDocument();
  });

  it('should apply custom className when provided', () => {
    const { container } = render(<ContainerList {...buildProps({ className: 'custom-class' })} />);

    expect(container.firstElementChild).toHaveClass('custom-class');
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <ContainerList
        {...buildProps({
          containers: [
            buildContainerVM({
              id: 'snap-1',
              name: 'Snapshot Container',
              skillCount: 7,
            }),
          ],
          selectedId: null,
          onSelect: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
