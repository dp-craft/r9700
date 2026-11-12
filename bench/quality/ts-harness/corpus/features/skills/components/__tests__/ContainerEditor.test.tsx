import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposedPromptVM, SortableSkillItemVM } from '../../types';
import { ContainerEditor } from '../ContainerEditor';

// -- Types --

interface ContainerEditorProps {
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  readonly skills: readonly SortableSkillItemVM[];
  readonly availableSkills: readonly { readonly id: string; readonly name: string }[];
  readonly onAddSkill: (skillId: string) => void;
  readonly onRemoveSkill: (skillId: string) => void;
  readonly onAutoSort: () => void;
  readonly composedPrompt: ComposedPromptVM;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDelete: (() => void) | null;
  readonly isNew: boolean;
  readonly sortableListSlot: React.ReactNode;
  readonly infoSlot: React.ReactNode;
  readonly className?: string;
}

// -- Builders --

const buildSortableSkillItemVM = (
  overrides?: Partial<SortableSkillItemVM>
): SortableSkillItemVM => ({
  id: 'skill-1',
  name: 'Test Skill',
  category: null,
  hasOrderingIssue: false,
  ...overrides,
});

const buildComposedPromptVM = (overrides?: Partial<ComposedPromptVM>): ComposedPromptVM => ({
  text: 'You are a helpful assistant.',
  tokenCount: 42,
  exceedsSoftLimit: false,
  exceedsHardLimit: false,
  ...overrides,
});

const buildProps = (overrides?: Partial<ContainerEditorProps>): ContainerEditorProps => ({
  name: 'My Container',
  onNameChange: vi.fn(),
  skills: [buildSortableSkillItemVM()],
  availableSkills: [
    { id: 'avail-1', name: 'Available Skill A' },
    { id: 'avail-2', name: 'Available Skill B' },
  ],
  onAddSkill: vi.fn(),
  onRemoveSkill: vi.fn(),
  onAutoSort: vi.fn(),
  composedPrompt: buildComposedPromptVM(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
  onDelete: vi.fn(),
  isNew: false,
  sortableListSlot: <div data-testid="sortable-list-slot">Sortable list content</div>,
  infoSlot: <div data-testid="info-slot">Info content</div>,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ContainerEditor', () => {
  // -- Smoke tests --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ContainerEditor {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing when isNew is true and onDelete is null', () => {
    const { container } = render(
      <ContainerEditor {...buildProps({ isNew: true, onDelete: null })} />
    );

    expect(container).toBeTruthy();
  });

  // -- Content tests: form fields --

  it('should display the name prop value in the name input', () => {
    render(<ContainerEditor {...buildProps({ name: 'Custom Container' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Custom Container');
  });

  it('should render the sortableListSlot content', () => {
    render(<ContainerEditor {...buildProps()} />);

    expect(screen.getByTestId('sortable-list-slot')).toBeInTheDocument();
    expect(screen.getByText('Sortable list content')).toBeInTheDocument();
  });

  it('should render the infoSlot content', () => {
    render(<ContainerEditor {...buildProps()} />);

    expect(screen.getByTestId('info-slot')).toBeInTheDocument();
    expect(screen.getByText('Info content')).toBeInTheDocument();
  });

  it('should display the token count from composedPrompt', () => {
    render(
      <ContainerEditor
        {...buildProps({ composedPrompt: buildComposedPromptVM({ tokenCount: 1234 }) })}
      />
    );

    expect(screen.getByText(/1234/)).toBeInTheDocument();
  });

  it('should display the composed prompt text in a preview area', () => {
    render(
      <ContainerEditor
        {...buildProps({
          composedPrompt: buildComposedPromptVM({ text: 'Full prompt preview text here' }),
        })}
      />
    );

    expect(screen.getByText('Full prompt preview text here')).toBeInTheDocument();
  });

  it('should show Save button', () => {
    render(<ContainerEditor {...buildProps()} />);

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('should show Cancel button', () => {
    render(<ContainerEditor {...buildProps()} />);

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('should show Delete button when onDelete is provided', () => {
    render(<ContainerEditor {...buildProps({ onDelete: vi.fn() })} />);

    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('should show Auto-sort button', () => {
    render(<ContainerEditor {...buildProps()} />);

    expect(screen.getByRole('button', { name: /auto-sort/i })).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onNameChange when typing in name input', async () => {
    const user = userEvent.setup();
    const onNameChange = vi.fn();
    render(<ContainerEditor {...buildProps({ name: '', onNameChange })} />);

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'a');

    expect(onNameChange).toHaveBeenCalledWith('a');
  });

  it('should call onAddSkill when a skill is selected from the add skill picker', async () => {
    const user = userEvent.setup();
    const onAddSkill = vi.fn();
    render(<ContainerEditor {...buildProps({ onAddSkill })} />);

    await user.click(screen.getByRole('combobox', { name: /add skill/i }));
    await user.click(screen.getByRole('option', { name: /available skill a/i }));

    expect(onAddSkill).toHaveBeenCalledWith('avail-1');
  });

  it('should call onAutoSort when Auto-sort button is clicked', async () => {
    const user = userEvent.setup();
    const onAutoSort = vi.fn();
    render(<ContainerEditor {...buildProps({ onAutoSort })} />);

    await user.click(screen.getByRole('button', { name: /auto-sort/i }));

    expect(onAutoSort).toHaveBeenCalledOnce();
  });

  it('should call onSave when Save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<ContainerEditor {...buildProps({ onSave })} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it('should call onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ContainerEditor {...buildProps({ onCancel })} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('should call onDelete when Delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<ContainerEditor {...buildProps({ onDelete })} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(onDelete).toHaveBeenCalledOnce();
  });

  // -- Conditional rendering --

  describe('when isNew is true', () => {
    it('should show "Create" instead of "Save" on the save button', () => {
      render(<ContainerEditor {...buildProps({ isNew: true, onDelete: null })} />);

      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    });

    it('should not show the Delete button when onDelete is null', () => {
      render(<ContainerEditor {...buildProps({ isNew: true, onDelete: null })} />);

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('should call onSave when Create button is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(<ContainerEditor {...buildProps({ isNew: true, onDelete: null, onSave })} />);

      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(onSave).toHaveBeenCalledOnce();
    });
  });

  describe('when onDelete is null (editing mode guard)', () => {
    it('should not render the Delete button', () => {
      render(<ContainerEditor {...buildProps({ onDelete: null })} />);

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });
  });

  describe('when composedPrompt.exceedsSoftLimit is true', () => {
    it('should show a soft limit warning', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({ exceedsSoftLimit: true }),
          })}
        />
      );

      expect(screen.getByText(/warning|soft limit|approaching/i)).toBeInTheDocument();
    });

    it('should not disable the Save button', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({ exceedsSoftLimit: true }),
          })}
        />
      );

      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
    });
  });

  describe('when composedPrompt.exceedsHardLimit is true', () => {
    it('should show a hard limit error', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({
              exceedsHardLimit: true,
              exceedsSoftLimit: true,
            }),
          })}
        />
      );

      expect(screen.getByText(/error|hard limit|exceeded|too long/i)).toBeInTheDocument();
    });

    it('should disable the Save button (FR-009a)', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({
              exceedsHardLimit: true,
              exceedsSoftLimit: true,
            }),
          })}
        />
      );

      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });

  describe('when composedPrompt limits are not exceeded', () => {
    it('should not show any limit warnings', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({
              exceedsSoftLimit: false,
              exceedsHardLimit: false,
            }),
          })}
        />
      );

      expect(screen.queryByText(/warning|soft limit|approaching/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/error|hard limit|exceeded|too long/i)).not.toBeInTheDocument();
    });

    it('should enable the Save button', () => {
      render(
        <ContainerEditor
          {...buildProps({
            composedPrompt: buildComposedPromptVM({
              exceedsSoftLimit: false,
              exceedsHardLimit: false,
            }),
          })}
        />
      );

      expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
    });
  });

  describe('when availableSkills is empty', () => {
    it('should render the add skill picker even with no available skills', () => {
      render(<ContainerEditor {...buildProps({ availableSkills: [] })} />);

      expect(screen.getByRole('combobox', { name: /add skill/i })).toBeInTheDocument();
    });
  });

  describe('when skills list is empty', () => {
    it('should render without crashing', () => {
      const { container } = render(<ContainerEditor {...buildProps({ skills: [] })} />);

      expect(container).toBeTruthy();
    });

    it('should still render the sortableListSlot', () => {
      render(<ContainerEditor {...buildProps({ skills: [] })} />);

      expect(screen.getByTestId('sortable-list-slot')).toBeInTheDocument();
    });
  });

  // -- Edge cases --

  it('should render with empty name', () => {
    render(<ContainerEditor {...buildProps({ name: '' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('');
  });

  it('should render with very long name', () => {
    const longName = 'A'.repeat(500);
    render(<ContainerEditor {...buildProps({ name: longName })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue(longName);
  });

  it('should render with special characters in name', () => {
    const specialName = '<script>alert("xss")</script>';
    render(<ContainerEditor {...buildProps({ name: specialName })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue(specialName);
  });

  it('should render with whitespace-only name', () => {
    render(<ContainerEditor {...buildProps({ name: '   ' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('   ');
  });

  it('should render with zero token count', () => {
    render(
      <ContainerEditor
        {...buildProps({ composedPrompt: buildComposedPromptVM({ tokenCount: 0 }) })}
      />
    );

    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('should render with empty composed prompt text', () => {
    const { container } = render(
      <ContainerEditor
        {...buildProps({
          composedPrompt: buildComposedPromptVM({ text: '', tokenCount: 0 }),
        })}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should render with very long composed prompt text', () => {
    const longText = 'X'.repeat(10000);
    const { container } = render(
      <ContainerEditor
        {...buildProps({
          composedPrompt: buildComposedPromptVM({ text: longText, tokenCount: 5000 }),
        })}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should render with many available skills', () => {
    const manySkills = Array.from({ length: 50 }, (_, i) => ({
      id: `skill-${i}`,
      name: `Skill ${i}`,
    }));
    const { container } = render(
      <ContainerEditor {...buildProps({ availableSkills: manySkills })} />
    );

    expect(container).toBeTruthy();
  });

  it('should render with many skills in the container', () => {
    const manySkills = Array.from({ length: 20 }, (_, i) =>
      buildSortableSkillItemVM({ id: `skill-${i}`, name: `Skill ${i}` })
    );
    const { container } = render(<ContainerEditor {...buildProps({ skills: manySkills })} />);

    expect(container).toBeTruthy();
  });

  it('should not call any callback on initial render', () => {
    const props = buildProps();
    render(<ContainerEditor {...props} />);

    expect(props.onNameChange).not.toHaveBeenCalled();
    expect(props.onAddSkill).not.toHaveBeenCalled();
    expect(props.onRemoveSkill).not.toHaveBeenCalled();
    expect(props.onAutoSort).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('should apply optional className prop', () => {
    const { container } = render(
      <ContainerEditor {...buildProps({ className: 'custom-class' })} />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  // -- Snapshot --

  it('should match inline snapshot for default editing state', () => {
    const { asFragment } = render(
      <ContainerEditor
        {...buildProps({
          onNameChange: vi.fn(),
          onAddSkill: vi.fn(),
          onRemoveSkill: vi.fn(),
          onAutoSort: vi.fn(),
          onSave: vi.fn(),
          onCancel: vi.fn(),
          onDelete: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
