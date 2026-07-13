// Boundary mocks — declared before imports (Vitest hoisting)
const mockSetFontSize = vi.fn();

vi.mock('@/features/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ fontSize: 'md', setFontSize: mockSetFontSize }),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FontSizeSwitchContainer } from '../FontSizeSwitchContainer';

describe('FontSizeSwitchContainer — L3 smoke', () => {
  beforeEach(() => {
    mockSetFontSize.mockClear();
  });

  it('should render the 3-state control with active segment reflecting store fontSize', () => {
    render(<FontSizeSwitchContainer />);
    const group = screen.getByRole('group', { name: 'fontSize.group' });
    expect(group).toBeDefined();
    expect(screen.getByRole('button', { name: 'fontSize.small' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'fontSize.large' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'fontSize.medium' }).getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('should call setFontSize when a size segment is clicked', () => {
    render(<FontSizeSwitchContainer />);
    fireEvent.click(screen.getByRole('button', { name: 'fontSize.large' }));
    expect(mockSetFontSize).toHaveBeenCalledWith('lg');
  });
});
