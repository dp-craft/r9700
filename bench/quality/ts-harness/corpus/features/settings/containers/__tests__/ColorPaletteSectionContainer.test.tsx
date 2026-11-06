import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// -- Boundary mocks (declared before imports per Vitest hoisting rules) --

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/db/appSettings', () => ({
  getAppSetting: vi.fn().mockResolvedValue(null),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

// -- Import after mocks --

import { useSettingsStore } from '../../stores/useSettingsStore';
import { ColorPaletteSectionContainer } from '../ColorPaletteSectionContainer';

// -- Store state snapshot for reset --

const initialState = useSettingsStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState(initialState, true);
});

describe('ColorPaletteSectionContainer', () => {
  it('should render without crashing', () => {
    const { container } = render(<ColorPaletteSectionContainer />);

    expect(container).toBeTruthy();
  });

  it('should render section heading from i18n translation key', () => {
    render(<ColorPaletteSectionContainer />);

    const heading = screen.getByRole('heading', { level: 3 });

    expect(heading).toHaveTextContent('settings.paletteHeading');
  });

  it('should pass the store-backed borderColor to the color input', () => {
    useSettingsStore.setState({ palette: { borderColor: '#ff8800' } });

    render(<ColorPaletteSectionContainer />);

    const input = screen.getByLabelText<HTMLInputElement>('settings.paletteBorderColorLabel');

    expect(input).toHaveValue('#ff8800');
  });

  it('should call setPaletteColor with borderColor key when the input changes', () => {
    const mockSetPaletteColor = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setPaletteColor: mockSetPaletteColor });

    render(<ColorPaletteSectionContainer />);

    const input = screen.getByLabelText<HTMLInputElement>('settings.paletteBorderColorLabel');
    fireEvent.change(input, { target: { value: '#123456' } });

    expect(mockSetPaletteColor).toHaveBeenCalledWith('borderColor', '#123456');
  });

  it('should call setPaletteColor with empty string to reset to default', async () => {
    const mockSetPaletteColor = vi.fn().mockResolvedValue(undefined);
    useSettingsStore.setState({ setPaletteColor: mockSetPaletteColor });
    const user = userEvent.setup();

    render(<ColorPaletteSectionContainer />);

    const resetButton = screen.getByRole('button', { name: 'settings.paletteResetLabel' });
    await user.click(resetButton);

    expect(mockSetPaletteColor).toHaveBeenCalledWith('borderColor', '');
  });

  it('should reflect the default border color when palette is at its initial value', () => {
    render(<ColorPaletteSectionContainer />);

    const input = screen.getByLabelText<HTMLInputElement>('settings.paletteBorderColorLabel');

    expect(input).toHaveValue('#e7e5e4');
  });
});
