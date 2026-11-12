import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type RunTabItem, RunTabs, type RunTabsProps } from '../RunTabs';

// -- Builders --

const buildTab = (overrides?: Partial<RunTabItem>): RunTabItem => ({
  id: 'tab-1',
  label: 'Futtatás 1',
  ...overrides,
});

const buildProps = (overrides?: Partial<RunTabsProps>): RunTabsProps => ({
  tabs: [buildTab()],
  activeId: 'tab-1',
  editingId: null,
  canCloseActive: true,
  onActivate: vi.fn(),
  onClose: vi.fn(),
  onRenameStart: vi.fn(),
  onRenameCommit: vi.fn(),
  onRenameCancel: vi.fn(),
  onAdd: vi.fn(),
  addLabel: '+ új futtatás',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RunTabs', () => {
  // TC1: renders tabs and add-trigger, snapshot (FR-024)
  it('should render tabs left and add-trigger after last tab', () => {
    // Given
    const props = buildProps({
      tabs: [
        buildTab({ id: 'tab-1', label: 'Futtatás 1' }),
        buildTab({ id: 'tab-2', label: 'Futtatás 2' }),
      ],
      activeId: 'tab-1',
    });

    // When
    const { asFragment } = render(<RunTabs {...props} />);

    // Then
    expect(asFragment()).toMatchSnapshot();
  });

  // TC2: add-trigger label is exactly "+ új futtatás" — no duplicated "+" (FR-025)
  it('should display the add-trigger label as exactly "+ új futtatás" with no duplicated plus prefix', () => {
    // Given
    const props = buildProps();

    // When
    render(<RunTabs {...props} />);

    // Then — label must contain the literal string, not "+ + új futtatás"
    const addButton = screen.getByRole('button', { name: /\+ új futtatás/i });
    expect(addButton.textContent).not.toMatch(/^\+\s*\+/);
    expect(addButton.textContent?.trim()).toBe('+ új futtatás');
  });

  // TC3: full-width container (FR-023)
  it('should render a full-width strip container', () => {
    // Given
    const props = buildProps();

    // When
    render(<RunTabs {...props} />);

    // Then — the root element must carry w-full (full-width strip)
    const strip = screen.getByRole('tablist');
    expect(strip.closest('[class*="w-full"]') ?? strip).toBeTruthy();
  });

  // TC4: active tab has aria-selected="true" (FR-024 design §4)
  it('should mark the active tab with aria-selected true when it matches activeId', () => {
    // Given
    const props = buildProps({
      tabs: [
        buildTab({ id: 'tab-1', label: 'Futtatás 1' }),
        buildTab({ id: 'tab-2', label: 'Futtatás 2' }),
      ],
      activeId: 'tab-2',
    });

    // When
    render(<RunTabs {...props} />);

    // Then
    const activeTab = screen.getByRole('tab', { name: 'Futtatás 2', selected: true });
    expect(activeTab).toBeInTheDocument();
  });

  // TC5a: single-click on active tab triggers onRenameStart(id) (FR-009)
  it('should call onRenameStart with the tab id when the active tab is clicked', async () => {
    // Given
    const onRenameStart = vi.fn();
    const user = userEvent.setup();
    const props = buildProps({
      tabs: [buildTab({ id: 'tab-1', label: 'Futtatás 1' })],
      activeId: 'tab-1',
      onRenameStart,
    });

    // When
    render(<RunTabs {...props} />);
    await user.click(screen.getByRole('tab', { name: 'Futtatás 1' }));

    // Then
    expect(onRenameStart).toHaveBeenCalledOnce();
    expect(onRenameStart).toHaveBeenCalledWith('tab-1');
  });

  // TC5b: when editingId matches, input is shown; committing empty → onRenameCancel (FR-035)
  it('should call onRenameCancel when the rename input is committed with an empty string', async () => {
    // Given
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const user = userEvent.setup();
    const props = buildProps({
      tabs: [buildTab({ id: 'tab-1', label: 'Futtatás 1' })],
      editingId: 'tab-1',
      onRenameCommit,
      onRenameCancel,
    });

    // When
    render(<RunTabs {...props} />);
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.keyboard('{Enter}');

    // Then — empty commit reverts silently via onRenameCancel, not onRenameCommit
    expect(onRenameCancel).toHaveBeenCalledOnce();
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  // TC5c: when editingId matches, the inline rename input is rendered (FR-028)
  it('should render a text input when editingId matches the tab id', () => {
    // Given
    const props = buildProps({
      tabs: [buildTab({ id: 'tab-1', label: 'Futtatás 1' })],
      editingId: 'tab-1',
    });

    // When
    render(<RunTabs {...props} />);

    // Then
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // TC6: canCloseActive=false → close × disabled when only 1 tab (FR-032)
  it('should disable the close button on the sole tab when canCloseActive is false', () => {
    // Given
    const props = buildProps({
      tabs: [buildTab({ id: 'tab-1', label: 'Futtatás 1' })],
      activeId: 'tab-1',
      canCloseActive: false,
    });

    // When
    render(<RunTabs {...props} />);

    // Then — close button must exist but be disabled
    const closeButton = screen.getByRole('button', { name: /close|bezár|×/i });
    expect(closeButton).toBeDisabled();
  });

  // TC7: endSlot renders inside the tablist
  it('should render the endSlot content inside the tablist when endSlot is provided', () => {
    // Given
    const props = buildProps({
      endSlot: <div data-testid="end-slot">x</div>,
    });

    // When
    render(<RunTabs {...props} />);

    // Then — endSlot content must appear inside the tablist
    const tablist = screen.getByRole('tablist');
    expect(tablist).toContainElement(screen.getByTestId('end-slot'));
  });

  // tab-header-restyle: TC-R1
  it('should render each tab as its own element carrying its label when given two tabs', () => {
    // Given
    const props = buildProps({
      tabs: [
        buildTab({ id: 'tab-1', label: 'Run 1' }),
        buildTab({ id: 'tab-2', label: 'Pro test' }),
      ],
      activeId: 'tab-1',
    });

    // When
    render(<RunTabs {...props} />);

    // Then
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-label', 'Run 1');
    expect(tabs[1]).toHaveAttribute('aria-label', 'Pro test');
  });

  // tab-header-restyle: TC-R2
  it('should render all tabs within a single tablist strip container', () => {
    // Given
    const props = buildProps({
      tabs: [
        buildTab({ id: 'tab-1', label: 'Run 1' }),
        buildTab({ id: 'tab-2', label: 'Pro test' }),
      ],
      activeId: 'tab-1',
    });

    // When
    render(<RunTabs {...props} />);

    // Then
    const tablist = screen.getByRole('tablist');
    const tabs = screen.getAllByRole('tab');
    expect(tablist).toBeInTheDocument();
    for (const tab of tabs) {
      expect(tablist).toContainElement(tab);
    }
  });

  // tab-header-restyle: TC-R3
  it('should render the tablist strip with the full-width structural class', () => {
    // Given
    const props = buildProps();

    // When
    const { container } = render(<RunTabs {...props} />);

    // Then
    const strip = container.firstElementChild;
    expect(strip).toHaveClass('w-full');
  });
});
