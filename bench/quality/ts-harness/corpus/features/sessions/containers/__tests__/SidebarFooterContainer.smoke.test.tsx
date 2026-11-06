// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('@/hooks/usePwaInstall', () => ({
  usePwaInstall: vi.fn(),
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePwaInstall } from '@/hooks/usePwaInstall';
import { ariaTree } from '@/test/serializers/aria-tree';

import { SidebarFooterContainer } from '../SidebarFooterContainer';

const mockPromptInstall = vi.fn().mockResolvedValue(undefined);

const seedHook = (canInstall: boolean): void => {
  vi.mocked(usePwaInstall).mockReturnValue({
    canInstall,
    promptInstall: mockPromptInstall,
  });
};

describe('SidebarFooterContainer — L3 smoke', () => {
  beforeEach(() => {
    mockPromptInstall.mockClear();
  });

  it('should render empty aria tree when canInstall is false', () => {
    seedHook(false);
    const { container } = render(<SidebarFooterContainer />);
    expect(ariaTree(container)).toMatchInlineSnapshot(`""`);
  });

  it('should render install button in aria tree when canInstall is true', () => {
    seedHook(true);
    const { container } = render(<SidebarFooterContainer />);
    expect(ariaTree(container)).toMatchInlineSnapshot(`"- button "common.installApp""`);
  });

  it('should invoke promptInstall when install button is clicked', async () => {
    seedHook(true);
    const user = userEvent.setup();
    render(<SidebarFooterContainer />);

    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      const name = btn.getAttribute('aria-label') ?? btn.textContent?.trim() ?? '(unnamed)';
      const callsBefore = mockPromptInstall.mock.calls.length;
      await user.click(btn);
      expect(
        mockPromptInstall.mock.calls.length,
        `Dead handler detected — button "${name}" did not invoke promptInstall`
      ).toBeGreaterThan(callsBefore);
    }
  });
});
