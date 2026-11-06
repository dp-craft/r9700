// Boundary mocks — declared before imports (Vitest hoisting)
vi.mock('../stores/useSkillStore', () => ({
  useSkillStore: vi.fn(),
}));

vi.mock('../hooks/useSkillLabels', () => ({
  useSkillLabels: vi.fn(),
}));

vi.mock('../containers/SkillListContainer', () => ({
  SkillListContainer: () => <div data-testid="skill-list" />,
}));

vi.mock('../containers/ContainerListContainer', () => ({
  ContainerListContainer: () => <div data-testid="container-list" />,
}));

vi.mock('../containers/SkillEditorContainer', () => ({
  SkillEditorContainer: () => <div data-testid="skill-editor" />,
}));

vi.mock('../containers/ContainerEditorContainer', () => ({
  ContainerEditorContainer: () => <div data-testid="container-editor" />,
}));

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillsContentContainer } from '@/features/skills/containers/SkillsContentContainer';
import { ariaTree } from '@/test/serializers/aria-tree';

import type { SkillLabels } from '../hooks/useSkillLabels';
import { useSkillLabels } from '../hooks/useSkillLabels';
import { useSkillStore } from '../stores/useSkillStore';

type StoreSelector = Parameters<typeof useSkillStore>[0];

const mockLoadSkills = vi.fn().mockResolvedValue(undefined);
const mockLoadContainers = vi.fn().mockResolvedValue(undefined);
const mockSetActiveTab = vi.fn();
const mockSelectSkill = vi.fn();
const mockSelectContainer = vi.fn();

const defaultLabels: SkillLabels = {
  newSkillLabel: 'New Skill',
  newSkillAriaLabel: 'skills.newSkill',
  newContainerLabel: 'New Container',
  newContainerAriaLabel: 'skills.newContainer',
  skillsPage: {
    tabSkillsLabel: 'skills.tabs.skills',
    tabContainersLabel: 'skills.tabs.containers',
  },
  skillList: {
    listAriaLabel: 'skills.skillsList',
    selectSkillAriaPrefix: 'skills.selectSkill',
    builtinBadgeLabel: 'skills.builtinBadge',
    uncategorizedBadgeLabel: 'skills.uncategorizedBadge',
  },
  skillEditor: {
    emptyStateMessage: 'skills.editorEmpty',
    uncategorizedWarning: 'skills.uncategorizedWarning',
    fieldNameLabel: 'skills.fieldName',
    fieldDescriptionLabel: 'skills.fieldDescription',
    fieldDescriptionPlaceholder: 'skills.fieldDescriptionPlaceholder',
    fieldPromptLabel: 'skills.fieldPrompt',
    fieldCommandPrefixLabel: 'skills.fieldCommandPrefix',
    fieldCategoryLabel: 'skills.fieldCategory',
    categoryNoneLabel: 'skills.categoryNone',
    categoryPersonaLabel: 'skills.categoryPersona',
    categoryContextLabel: 'skills.categoryContext',
    categoryConstraintsLabel: 'skills.categoryConstraints',
    categoryFormatLabel: 'skills.categoryFormat',
    categoryExamplesLabel: 'skills.categoryExamples',
    saveLabel: 'common.save',
    createLabel: 'common.create',
    deleteLabel: 'common.delete',
    duplicateLabel: 'skills.duplicate',
    cancelLabel: 'common.cancel',
    actionsAriaLabel: 'skills.skillActions',
  },
  containerList: {
    listAriaLabel: 'skills.containersList',
    selectContainerAriaPrefix: 'skills.selectContainer',
    skillCountSingularLabel: 'skills.skillCountSingular',
    skillCountPluralLabel: 'skills.skillCountPlural',
  },
  containerEditor: {
    fieldNameLabel: 'skills.containerFieldName',
    fieldSkillsLabel: 'skills.containerFieldSkills',
    autoSortLabel: 'skills.autoSort',
    addSkillPlaceholder: 'skills.addSkillPlaceholder',
    addSkillAriaLabel: 'skills.addSkillAria',
    tokenCountSuffix: 'skills.tokenCount',
    softLimitWarning: 'skills.tokenLimitWarning',
    hardLimitError: 'skills.tokenLimitError',
    actionsAriaLabel: 'skills.containerActions',
    saveLabel: 'common.save',
    createLabel: 'common.create',
    cancelLabel: 'common.cancel',
    deleteLabel: 'common.delete',
  },
  sessionSkillIndicator: {
    skillSetLabel: 'skills.skillSetLabel',
    changeAriaLabel: 'skills.changeSkillSet',
    selectSkillSetLabel: 'skills.selectSkillSet',
    noSkillsInContainerLabel: 'skills.noSkillsInContainer',
    noSkillsActiveLabel: 'skills.noSkillsActive',
    noSkillsOptionLabel: 'skills.noSkillsOption',
    approximateTokenCountSuffix: 'skills.approximateTokenCount',
    skillCountSingularLabel: 'skills.skillCountSingular',
    skillCountPluralLabel: 'skills.skillCountPlural',
  },
  sortableSkillItem: {
    dragToReorderAriaLabel: 'skills.dragToReorder',
    removeAriaLabel: 'skills.remove',
  },
  canonicalOrderInfo: {
    buttonAriaLabel: 'skills.orderInfoButton',
    dialogTitle: 'skills.orderInfoTitle',
    dialogDescription: 'skills.orderInfoDescription',
    layersAriaLabel: 'skills.orderInfoLayersAria',
    layerPersonaName: 'skills.layerPersonaName',
    layerPersonaDescription: 'skills.layerPersonaDescription',
    layerContextName: 'skills.layerContextName',
    layerContextDescription: 'skills.layerContextDescription',
    layerConstraintsName: 'skills.layerConstraintsName',
    layerConstraintsDescription: 'skills.layerConstraintsDescription',
    layerFormatName: 'skills.layerFormatName',
    layerFormatDescription: 'skills.layerFormatDescription',
    layerExamplesName: 'skills.layerExamplesName',
    layerExamplesDescription: 'skills.layerExamplesDescription',
  },
  promptPreview: {
    ariaLabel: 'skills.promptPreview',
  },
  tokenCounter: {
    approximateTokenCountSuffix: 'skills.approximateTokenCount',
  },
};

const seedStore = (activeTab: 'skills' | 'containers' = 'skills'): void => {
  vi.mocked(useSkillStore).mockImplementation((selector: StoreSelector) => {
    const state = {
      activeTab,
      setActiveTab: mockSetActiveTab,
      selectSkill: mockSelectSkill,
      selectContainer: mockSelectContainer,
      selectedSkillId: null,
      selectedContainerId: null,
    };
    return selector(state as unknown as Parameters<StoreSelector>[0]);
  });

  Object.assign(vi.mocked(useSkillStore), {
    getState: vi.fn().mockReturnValue({
      loadSkills: mockLoadSkills,
      loadContainers: mockLoadContainers,
    }),
  });

  vi.mocked(useSkillLabels).mockReturnValue(defaultLabels);
};

describe('SkillsContentContainer — L3 smoke', () => {
  beforeEach(() => {
    mockLoadSkills.mockClear();
    mockLoadContainers.mockClear();
    mockSetActiveTab.mockClear();
    mockSelectSkill.mockClear();
    mockSelectContainer.mockClear();
  });

  it('should render MfLayoutSkeleton with header, left-column, and right-column', () => {
    seedStore();
    render(<SkillsContentContainer />);
    expect(screen.getByTestId('mf-layout-skeleton')).toBeDefined();
    expect(screen.getByTestId('layout-header')).toBeDefined();
    expect(screen.getByTestId('left-column')).toBeDefined();
    expect(screen.getByTestId('right-column')).toBeDefined();
  });

  it('should place the tablist inside the layout header', () => {
    seedStore();
    render(<SkillsContentContainer />);
    const header = screen.getByTestId('layout-header');
    expect(header.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('should order header before left-column before right-column in the DOM', () => {
    seedStore();
    render(<SkillsContentContainer />);
    const header = screen.getByTestId('layout-header');
    const left = screen.getByTestId('left-column');
    const right = screen.getByTestId('right-column');
    expect(header.compareDocumentPosition(left) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('should render skills tab aria structure when activeTab is skills', () => {
    seedStore();
    const { container } = render(<SkillsContentContainer />);
    expect(ariaTree(container)).toMatchInlineSnapshot(`
      "- banner
        - tablist
          - tab "skills.tabs.containers"
          - tab "skills.tabs.skills" (selected)
        - button "skills.newSkill"
      - complementary "skills.layout.listAria"
      - region "skills.layout.editorAria""
    `);
  });

  it('should call loadSkills and loadContainers on mount', () => {
    seedStore();
    render(<SkillsContentContainer />);
    expect(mockLoadSkills).toHaveBeenCalledTimes(1);
    expect(mockLoadContainers).toHaveBeenCalledTimes(1);
  });

  it('should render skill-list and skill-editor slots when activeTab is skills', () => {
    seedStore();
    render(<SkillsContentContainer />);
    expect(screen.getByTestId('skill-list')).toBeDefined();
    expect(screen.getByTestId('skill-editor')).toBeDefined();
  });

  it('should render container-list and container-editor slots when activeTab is containers', () => {
    seedStore('containers');
    render(<SkillsContentContainer />);
    expect(screen.getByTestId('container-list')).toBeDefined();
    expect(screen.getByTestId('container-editor')).toBeDefined();
  });

  it('should invoke store actions when header action buttons are clicked', async () => {
    seedStore();
    const user = userEvent.setup();
    render(<SkillsContentContainer />);

    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      const name = btn.getAttribute('aria-label') ?? btn.textContent?.trim() ?? '(unnamed)';
      const callsBefore = mockSelectSkill.mock.calls.length + mockSelectContainer.mock.calls.length;
      await user.click(btn);
      const callsAfter = mockSelectSkill.mock.calls.length + mockSelectContainer.mock.calls.length;
      expect(
        callsAfter,
        `Dead handler detected — button "${name}" did not invoke any store action`
      ).toBeGreaterThan(callsBefore);
    }
  });
});
