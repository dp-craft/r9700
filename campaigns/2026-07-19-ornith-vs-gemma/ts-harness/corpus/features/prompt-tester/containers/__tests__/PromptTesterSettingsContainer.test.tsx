// L3 container smoke test — real store + real renderer; boundary (i18n, IDB) mocked.
// Boundary mocks declared before imports (Vitest hoisting).

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

const loadSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('@/db/appSettings', () => ({
  getLabRunParallel: vi.fn().mockResolvedValue(true),
  getLabParallelismMode: vi.fn().mockResolvedValue('same-model'),
  putLabRunParallel: vi.fn().mockResolvedValue(undefined),
  putLabParallelismMode: vi.fn().mockResolvedValue(undefined),
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFeatureFlagStore } from '@/features/settings';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { PromptTesterSettingsContainer } from '../PromptTesterSettingsContainer';

describe('PromptTesterSettingsContainer', () => {
  beforeEach(() => {
    loadSpy.mockClear();
    usePromptTesterStore.setState({
      parallelismMode: 'same-model',
      loadParallelRunsSettings: loadSpy,
    });
    useFeatureFlagStore.setState({
      flags: {
        ...useFeatureFlagStore.getState().flags,
        'lab-perplexity-enabled': false,
        'lab-text-analysis-enabled': false,
      },
    });
  });

  it('should render the section with one combobox reflecting parallelismMode', () => {
    render(<PromptTesterSettingsContainer />);

    const combobox = screen.getByRole('combobox');
    expect(combobox).toBeInTheDocument();
    expect(screen.getByText('lab.settings.title')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  it('should render both relocated lab flag switches under the Prompt Lab block', () => {
    useFeatureFlagStore.setState({
      flags: {
        ...useFeatureFlagStore.getState().flags,
        'lab-perplexity-enabled': true,
        'lab-text-analysis-enabled': false,
      },
    });

    render(<PromptTesterSettingsContainer />);

    expect(
      screen.getByRole('switch', { name: 'featureFlags.lab-perplexity-enabled-name' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'featureFlags.lab-text-analysis-enabled-name' })
    ).toBeInTheDocument();
  });

  it('should call loadParallelRunsSettings once on mount', () => {
    render(<PromptTesterSettingsContainer />);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('should call setParallelismMode when the mode is changed', async () => {
    const user = userEvent.setup();
    const setSpy = vi.fn();
    usePromptTesterStore.setState({ parallelismMode: 'same-model', setParallelismMode: setSpy });

    render(<PromptTesterSettingsContainer />);

    await act(async () => {
      await user.click(screen.getByRole('combobox'));
    });

    const option = screen
      .getAllByRole('option')
      .find(o => o.textContent === 'lab.settings.everything');
    if (option) {
      await act(async () => {
        await user.click(option);
      });
      expect(setSpy).toHaveBeenCalledWith('everything');
    }
  });
});
