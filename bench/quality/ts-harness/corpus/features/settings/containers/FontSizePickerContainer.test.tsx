import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FontSize } from '../stores/useSettingsStore';

// -- Mocks --

const mockSetFontSize = vi.fn();
let mockFontSize: FontSize = 'md';

vi.mock('../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ fontSize: mockFontSize, setFontSize: mockSetFontSize }),
}));

vi.mock('../components/FontSizePicker', () => ({
  FontSizePicker: ({
    fontSize,
    onFontSizeChange,
  }: {
    readonly fontSize: FontSize;
    readonly onFontSizeChange: (size: FontSize) => void;
  }) => (
    <div data-testid="font-size-picker">
      <span data-testid="font-size-value">{fontSize}</span>
      <button type="button" data-testid="change-font-size" onClick={() => onFontSizeChange('lg')}>
        Change
      </button>
    </div>
  ),
}));

// -- Import after mocks --

import { FontSizePickerContainer } from './FontSizePickerContainer';

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
  mockFontSize = 'md';
});

describe('FontSizePickerContainer', () => {
  it('should render without crashing', () => {
    const { container } = render(<FontSizePickerContainer />);

    expect(container).toBeTruthy();
  });

  it('should pass fontSize from store to FontSizePicker renderer', () => {
    mockFontSize = 'sm';

    render(<FontSizePickerContainer />);

    expect(screen.getByTestId('font-size-value')).toHaveTextContent('sm');
  });

  it('should pass the default fontSize md to FontSizePicker renderer', () => {
    mockFontSize = 'md';

    render(<FontSizePickerContainer />);

    expect(screen.getByTestId('font-size-value')).toHaveTextContent('md');
  });

  it('should pass fontSize lg to FontSizePicker when store returns lg', () => {
    mockFontSize = 'lg';

    render(<FontSizePickerContainer />);

    expect(screen.getByTestId('font-size-value')).toHaveTextContent('lg');
  });

  it('should call setFontSize from the store when onFontSizeChange is triggered', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    render(<FontSizePickerContainer />);

    await user.click(screen.getByTestId('change-font-size'));

    expect(mockSetFontSize).toHaveBeenCalledOnce();
    expect(mockSetFontSize).toHaveBeenCalledWith('lg');
  });
});
