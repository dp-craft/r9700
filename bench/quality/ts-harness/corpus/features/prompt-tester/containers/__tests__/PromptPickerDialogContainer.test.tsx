// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: () => Promise.resolve([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
  getLabRunById: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi
    .fn()
    .mockResolvedValue({ modellek: false, systemSkill: false, userPrompt: false }),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(undefined),
  putAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/archivedRuns', () => ({
  getArchivedRuns: vi.fn().mockResolvedValue([]),
  archiveRun: vi.fn().mockResolvedValue(undefined),
  deleteArchivedRuns: vi.fn().mockResolvedValue(undefined),
  buildRunExport: vi.fn().mockReturnValue([]),
}));

vi.mock('@/features/skills', () => ({
  useSkillStore: vi.fn(),
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AtomicSkillDTO, SkillContainerDTO } from '@/db/idb';
import { useSkillStore } from '@/features/skills';
import { composePrompt } from '@/lib/prompt-composer';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { PromptPickerDialogContainer } from '../PromptPickerDialogContainer';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildSkill(id: string, name: string, prompt: string): AtomicSkillDTO {
  return {
    id,
    name,
    prompt,
    type: 'custom',
    category: null,
    commandPrefix: null,
    conditions: null,
    description: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function buildContainer(id: string, name: string, skillIds: string[]): SkillContainerDTO {
  return { id, name, skillIds, createdAt: 0, updatedAt: 0 };
}

// ---------------------------------------------------------------------------
// Store seed helpers
// ---------------------------------------------------------------------------

const addSystemPromptMock = vi.fn();
const closePickerMock = vi.fn();
const setPickerActiveTabMock = vi.fn();

function seedPromptTesterStore(
  activeTab: 'packages' | 'skills' | 'history' | 'blank' = 'packages'
): void {
  usePromptTesterStore.setState({
    pickerOpen: true,
    pickerActiveTab: activeTab,
    pickerHistoryEntries: [],
    addSystemPromptToActiveRun: addSystemPromptMock,
    closePicker: closePickerMock,
    setPickerActiveTab: setPickerActiveTabMock,
  });
}

function seedSkillStore(skills: AtomicSkillDTO[], containers: SkillContainerDTO[]): void {
  (useSkillStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: { skills: AtomicSkillDTO[]; containers: SkillContainerDTO[] }) => unknown) =>
      selector({ skills, containers })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptPickerDialogContainer', () => {
  beforeEach(() => {
    addSystemPromptMock.mockClear();
    closePickerMock.mockClear();
    setPickerActiveTabMock.mockClear();
  });

  describe('package selection', () => {
    it('should call addSystemPromptToActiveRun with composed prompt when a 2-skill package is selected', async () => {
      const skill1 = buildSkill('s1', 'Alpha', 'p1');
      const skill2 = buildSkill('s2', 'Beta', 'p2');
      const container = buildContainer('c1', 'Pkg', ['s1', 's2']);

      seedSkillStore([skill1, skill2], [container]);
      seedPromptTesterStore('packages');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      const option = screen.getByRole('option', { name: /Pkg/i });
      await user.click(option);

      const expectedPrompt = composePrompt([skill1, skill2]).text;
      expect(addSystemPromptMock).toHaveBeenCalledWith({
        kind: 'container',
        containerId: 'c1',
        prompt: expectedPrompt,
      });
    });

    it('should call closePicker after a package is selected', async () => {
      const skill1 = buildSkill('s1', 'Alpha', 'p1');
      const container = buildContainer('c1', 'Pkg', ['s1']);

      seedSkillStore([skill1], [container]);
      seedPromptTesterStore('packages');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      await user.click(screen.getByRole('option', { name: /Pkg/i }));

      expect(closePickerMock).toHaveBeenCalledOnce();
    });

    it('should call addSystemPromptToActiveRun with empty prompt when a zero-skill package is selected', async () => {
      const container = buildContainer('c2', 'Empty', []);

      seedSkillStore([], [container]);
      seedPromptTesterStore('packages');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      await user.click(screen.getByRole('option', { name: /Empty/i }));

      expect(addSystemPromptMock).toHaveBeenCalledWith({
        kind: 'container',
        containerId: 'c2',
        prompt: '',
      });
    });
  });

  describe('blank tab confirm', () => {
    it('should call addSystemPromptToActiveRun with kind blank and empty string when Add is clicked without typing', async () => {
      seedSkillStore([], []);
      seedPromptTesterStore('blank');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      await user.click(screen.getByRole('button', { name: 'lab.promptPicker.confirmBlank' }));

      expect(addSystemPromptMock).toHaveBeenCalledWith({ kind: 'blank', prompt: '' });
    });

    it('should call addSystemPromptToActiveRun with kind blank and trimmed typed text when user types then clicks Add', async () => {
      seedSkillStore([], []);
      seedPromptTesterStore('blank');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      await user.type(screen.getByTestId('custom-prompt-textarea'), '  my prompt  ');
      await user.click(screen.getByRole('button', { name: 'lab.promptPicker.confirmBlank' }));

      expect(addSystemPromptMock).toHaveBeenCalledWith({ kind: 'blank', prompt: 'my prompt' });
    });

    it('should call closePicker after the blank Add button is clicked', async () => {
      seedSkillStore([], []);
      seedPromptTesterStore('blank');

      const user = userEvent.setup();
      render(<PromptPickerDialogContainer />);

      await user.click(screen.getByRole('button', { name: 'lab.promptPicker.confirmBlank' }));

      expect(closePickerMock).toHaveBeenCalledOnce();
    });
  });

  describe('localization', () => {
    it('should render picker labels as i18n keys (no raw key visible to user via identity translation)', () => {
      seedSkillStore([], []);
      seedPromptTesterStore('skills');

      render(<PromptPickerDialogContainer />);

      // Identity mock returns key as value; assert at least one label key is rendered
      // (the dialog title must appear in the DOM)
      expect(screen.getByText('lab.promptPicker.title')).toBeInTheDocument();
    });

    it('should render tab labels via translation and not fall back to raw untranslated strings', () => {
      seedSkillStore([], []);
      seedPromptTesterStore('skills');

      render(<PromptPickerDialogContainer />);

      // Each tab trigger text must equal the key (identity translator) — not hardcoded English
      expect(screen.getByText('lab.promptPicker.tabSkills')).toBeInTheDocument();
      expect(screen.getByText('lab.promptPicker.tabPackages')).toBeInTheDocument();
      expect(screen.getByText('lab.promptPicker.tabHistory')).toBeInTheDocument();
      expect(screen.getByText('lab.promptPicker.tabBlank')).toBeInTheDocument();
    });
  });
});
