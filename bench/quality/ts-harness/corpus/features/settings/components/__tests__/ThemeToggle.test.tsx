/**
 * L2 Renderer test — canonical ADR-018 exemplar.
 *
 * Shape (3 `it` blocks, 5 test cases total):
 *   1. One file-based snapshot with default seeded props (light theme).
 *      The global `class-strip` serializer strips Tailwind class churn; only
 *      tag tree, ARIA attrs, `data-*`, and text content remain in the .snap.
 *   2. Conditional-render snapshot: `theme='dark'` shifts `aria-pressed` to the
 *      Dark button — a distinct visible branch that the default snapshot does not
 *      cover. Vitest stores it as a second key in the same .snap file.
 *   3. Parametrized callback: one `it.each` over the three ThemeMode values
 *      verifies that clicking each button calls `onThemeChange` with the correct
 *      argument. No structural assertions — those are covered by the snapshots.
 *
 * FORBIDDEN (covered by the snapshot — MUST NOT be added):
 *   - "should render without crashing"
 *   - "should render exactly N buttons"
 *   - "should have aria-label X" / role presence assertions
 *   - "should apply data-testid X"
 *   - toHaveClass / className assertions
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggle, type ThemeToggleProps } from '../ThemeToggle';

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const buildProps = (overrides?: Partial<ThemeToggleProps>): ThemeToggleProps => ({
  theme: 'light',
  onThemeChange: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ThemeToggle', () => {
  // 1. Default snapshot — light theme is `aria-pressed="true"`, others false.
  it('should match snapshot when theme is light (default props)', () => {
    const { asFragment } = render(<ThemeToggle {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  // 2. Conditional-render snapshot — pressing state moves to the Dark button.
  it('should match snapshot when theme is dark (pressed state on Dark button)', () => {
    const { asFragment } = render(<ThemeToggle {...buildProps({ theme: 'dark' })} />);

    expect(asFragment()).toMatchSnapshot();
  });

  // 3. Callback: one case per ThemeMode value.
  it.each([
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'System'],
  ] as const)('should call onThemeChange with "%s" when the %s button is clicked', async (mode, label) => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    render(<ThemeToggle {...buildProps({ onThemeChange })} />);

    await user.click(screen.getByRole('button', { name: label }));

    expect(onThemeChange).toHaveBeenCalledOnce();
    expect(onThemeChange).toHaveBeenCalledWith(mode);
  });
});
