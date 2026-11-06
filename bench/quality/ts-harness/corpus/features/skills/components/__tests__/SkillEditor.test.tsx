import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillEditorVM } from '../../types';
import { SkillEditor } from '../SkillEditor';

// -- Types --

interface SkillEditorProps {
  readonly skill: SkillEditorVM | null;
  readonly isNew: boolean;
  readonly name: string;
  readonly prompt: string;
  readonly category: 'persona' | 'context' | 'constraints' | 'format' | 'examples' | null;
  readonly commandPrefix: string;
  readonly description: string;
  readonly onNameChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onPromptChange: (value: string) => void;
  readonly onCategoryChange: (value: string) => void;
  readonly onCommandPrefixChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onCancel: () => void;
}

// -- Builders --

const buildSkillEditorVM = (overrides?: Partial<SkillEditorVM>): SkillEditorVM => ({
  id: 'skill-1',
  name: 'Test Skill',
  prompt: 'Test prompt text',
  type: 'custom',
  category: null,
  commandPrefix: null,
  description: null,
  ...overrides,
});

const buildProps = (overrides?: Partial<SkillEditorProps>): SkillEditorProps => ({
  skill: buildSkillEditorVM(),
  isNew: false,
  name: 'Test Skill',
  prompt: 'Test prompt text',
  category: null,
  commandPrefix: '',
  description: '',
  onNameChange: vi.fn(),
  onDescriptionChange: vi.fn(),
  onPromptChange: vi.fn(),
  onCategoryChange: vi.fn(),
  onCommandPrefixChange: vi.fn(),
  onSave: vi.fn(),
  onDelete: vi.fn(),
  onDuplicate: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SkillEditor', () => {
  // -- Smoke tests --

  it('should render without crashing when skill is null', () => {
    const { container } = render(<SkillEditor {...buildProps({ skill: null })} />);

    expect(container).toBeTruthy();
  });

  it('should render the form when skill is provided', () => {
    render(<SkillEditor {...buildProps()} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toBeInTheDocument();
  });

  // -- Content tests: empty state --

  it('should show an empty state message when skill is null', () => {
    render(<SkillEditor {...buildProps({ skill: null })} />);

    expect(screen.queryByRole('textbox', { name: /name/i })).not.toBeInTheDocument();
  });

  // -- Content tests: form fields --

  it('should display the name prop value in the name input', () => {
    render(<SkillEditor {...buildProps({ name: 'My Custom Skill' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('My Custom Skill');
  });

  it('should display the prompt prop value in the prompt textarea', () => {
    render(<SkillEditor {...buildProps({ prompt: 'You are a helpful assistant.' })} />);

    expect(screen.getByRole('textbox', { name: /prompt/i })).toHaveValue(
      'You are a helpful assistant.'
    );
  });

  it('should display the commandPrefix prop value in the command prefix input', () => {
    render(<SkillEditor {...buildProps({ commandPrefix: '/helper' })} />);

    expect(screen.getByRole('textbox', { name: /command prefix/i })).toHaveValue('/helper');
  });

  it('should show the category value in the category select', () => {
    render(<SkillEditor {...buildProps({ category: 'persona' })} />);

    const combobox = screen.getByRole('combobox', { name: /category/i });

    expect(combobox).toHaveTextContent(/persona/i);
  });

  it('should show a placeholder when category is null', () => {
    render(<SkillEditor {...buildProps({ category: null })} />);

    const combobox = screen.getByRole('combobox', { name: /category/i });

    expect(combobox).toHaveTextContent(/none/i);
  });

  // -- Callback tests --

  it('should call onNameChange when typing in name input', async () => {
    const user = userEvent.setup();
    const onNameChange = vi.fn();
    render(<SkillEditor {...buildProps({ name: '', onNameChange })} />);

    await user.type(screen.getByRole('textbox', { name: /name/i }), 'a');

    expect(onNameChange).toHaveBeenCalledWith('a');
  });

  it('should call onPromptChange when typing in prompt textarea', async () => {
    const user = userEvent.setup();
    const onPromptChange = vi.fn();
    render(<SkillEditor {...buildProps({ prompt: '', onPromptChange })} />);

    await user.type(screen.getByRole('textbox', { name: /prompt/i }), 'x');

    expect(onPromptChange).toHaveBeenCalledWith('x');
  });

  it('should call onCommandPrefixChange when typing in command prefix input', async () => {
    const user = userEvent.setup();
    const onCommandPrefixChange = vi.fn();
    render(<SkillEditor {...buildProps({ commandPrefix: '', onCommandPrefixChange })} />);

    await user.type(screen.getByRole('textbox', { name: /command prefix/i }), '/');

    expect(onCommandPrefixChange).toHaveBeenCalledWith('/');
  });

  it('should call onCategoryChange when changing category select', async () => {
    const user = userEvent.setup();
    const onCategoryChange = vi.fn();
    render(<SkillEditor {...buildProps({ category: null, onCategoryChange })} />);

    await user.click(screen.getByRole('combobox', { name: /category/i }));
    await user.click(screen.getByRole('option', { name: /persona/i }));

    expect(onCategoryChange).toHaveBeenCalledOnce();
    expect(onCategoryChange).toHaveBeenCalledWith('persona');
  });

  it('should call onSave when Save button is clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SkillEditor {...buildProps({ onSave })} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it('should call onDelete when Delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<SkillEditor {...buildProps({ onDelete })} />);

    await user.click(screen.getByRole('button', { name: /delete/i }));

    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('should call onDuplicate when Duplicate button is clicked', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(<SkillEditor {...buildProps({ onDuplicate })} />);

    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(onDuplicate).toHaveBeenCalledOnce();
  });

  it('should call onCancel when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<SkillEditor {...buildProps({ onCancel })} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  // -- Built-in read-only state --

  describe('when skill type is builtin', () => {
    const builtinSkill = buildSkillEditorVM({ type: 'builtin' });
    const builtinProps = (): SkillEditorProps =>
      buildProps({ skill: builtinSkill, name: builtinSkill.name, prompt: builtinSkill.prompt });

    it('should disable the name input', () => {
      render(<SkillEditor {...builtinProps()} />);

      expect(screen.getByRole('textbox', { name: /name/i })).toBeDisabled();
    });

    it('should disable the prompt textarea', () => {
      render(<SkillEditor {...builtinProps()} />);

      expect(screen.getByRole('textbox', { name: /prompt/i })).toBeDisabled();
    });

    it('should disable the command prefix input', () => {
      render(<SkillEditor {...builtinProps()} />);

      expect(screen.getByRole('textbox', { name: /command prefix/i })).toBeDisabled();
    });

    it('should show an enabled Delete button for builtin skills', () => {
      render(<SkillEditor {...builtinProps()} />);

      const deleteButton = screen.getByRole('button', { name: /delete/i });

      expect(deleteButton).toBeInTheDocument();
      expect(deleteButton).not.toBeDisabled();
    });

    it('should still show the Duplicate button', () => {
      render(<SkillEditor {...builtinProps()} />);

      expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
    });

    it('should still allow clicking Cancel', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<SkillEditor {...builtinProps()} onCancel={onCancel} />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  // -- Category warning --

  it('should show a warning when category is null', () => {
    render(<SkillEditor {...buildProps({ category: null })} />);

    expect(screen.getByText(/uncategorized/i)).toBeInTheDocument();
  });

  it('should not show category warning when category is set', () => {
    render(<SkillEditor {...buildProps({ category: 'persona' })} />);

    expect(screen.queryByText(/uncategorized/i)).not.toBeInTheDocument();
  });

  // -- New skill mode --

  describe('when isNew is true', () => {
    it('should show "Create" instead of "Save" on the save button', () => {
      render(<SkillEditor {...buildProps({ isNew: true })} />);

      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
    });

    it('should not show the Delete button', () => {
      render(<SkillEditor {...buildProps({ isNew: true })} />);

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('should not show the Duplicate button', () => {
      render(<SkillEditor {...buildProps({ isNew: true })} />);

      expect(screen.queryByRole('button', { name: /duplicate/i })).not.toBeInTheDocument();
    });

    it('should call onSave when Create button is clicked', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(<SkillEditor {...buildProps({ isNew: true, onSave })} />);

      await user.click(screen.getByRole('button', { name: /create/i }));

      expect(onSave).toHaveBeenCalledOnce();
    });
  });

  // -- Edge cases --

  it('should render with empty name', () => {
    render(<SkillEditor {...buildProps({ name: '' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('');
  });

  it('should render with empty prompt', () => {
    render(<SkillEditor {...buildProps({ prompt: '' })} />);

    expect(screen.getByRole('textbox', { name: /prompt/i })).toHaveValue('');
  });

  it('should render with empty command prefix', () => {
    render(<SkillEditor {...buildProps({ commandPrefix: '' })} />);

    expect(screen.getByRole('textbox', { name: /command prefix/i })).toHaveValue('');
  });

  it('should render with very long name', () => {
    const longName = 'A'.repeat(500);
    render(<SkillEditor {...buildProps({ name: longName })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue(longName);
  });

  it('should render with very long prompt', () => {
    const longPrompt = 'B'.repeat(10000);
    render(<SkillEditor {...buildProps({ prompt: longPrompt })} />);

    expect(screen.getByRole('textbox', { name: /prompt/i })).toHaveValue(longPrompt);
  });

  it('should render with special characters in name', () => {
    const specialName = '<script>alert("xss")</script>';
    render(<SkillEditor {...buildProps({ name: specialName })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue(specialName);
  });

  it('should render with whitespace-only name', () => {
    render(<SkillEditor {...buildProps({ name: '   ' })} />);

    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('   ');
  });

  it('should not call any callback on initial render', () => {
    const props = buildProps();
    render(<SkillEditor {...props} />);

    expect(props.onNameChange).not.toHaveBeenCalled();
    expect(props.onPromptChange).not.toHaveBeenCalled();
    expect(props.onCategoryChange).not.toHaveBeenCalled();
    expect(props.onCommandPrefixChange).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onDuplicate).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  // -- All category options --

  it('should display all category options when select is opened', async () => {
    const user = userEvent.setup();
    render(<SkillEditor {...buildProps()} />);

    await user.click(screen.getByRole('combobox', { name: /category/i }));

    expect(screen.getByRole('option', { name: /persona/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /context/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /constraints/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /format/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /examples/i })).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match inline snapshot for default custom skill', () => {
    const { asFragment } = render(
      <SkillEditor
        {...buildProps({
          onNameChange: vi.fn(),
          onPromptChange: vi.fn(),
          onCategoryChange: vi.fn(),
          onCommandPrefixChange: vi.fn(),
          onSave: vi.fn(),
          onDelete: vi.fn(),
          onDuplicate: vi.fn(),
          onCancel: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div>
          <div
            data-slot="scroll-area"
            dir="ltr"
          >
            <style>
              [data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}
            </style>
            <div
              data-radix-scroll-area-viewport=""
              data-slot="scroll-area-viewport"
            >
              <div>
                <div>
                  <div>
                    <label
                      data-slot="label"
                      for="skill-name"
                    >
                      Name
                    </label>
                    <input
                      aria-label="Name"
                      data-slot="input"
                      data-testid="skills-name-input"
                      id="skill-name"
                      value="Test Skill"
                    />
                  </div>
                  <div>
                    <label
                      data-slot="label"
                      for="skill-description"
                    >
                      Description
                    </label>
                    <textarea
                      aria-label="Description"
                      data-slot="textarea"
                      data-testid="skills-description-input"
                      id="skill-description"
                      maxlength="500"
                      placeholder="Optional description for this skill..."
                      rows="2"
                    />
                  </div>
                  <div>
                    <label
                      data-slot="label"
                      for="skill-prompt"
                    >
                      Prompt
                    </label>
                    <textarea
                      aria-label="Prompt"
                      data-slot="textarea"
                      data-testid="skills-prompt-input"
                      id="skill-prompt"
                      rows="8"
                    >
                      Test prompt text
                    </textarea>
                  </div>
                  <div>
                    <label
                      data-slot="label"
                      for="skill-command-prefix"
                    >
                      Command Prefix
                    </label>
                    <input
                      aria-label="Command Prefix"
                      data-slot="input"
                      data-testid="skills-command-prefix-input"
                      id="skill-command-prefix"
                      value=""
                    />
                  </div>
                  <div>
                    <label
                      data-slot="label"
                    >
                      Category
                    </label>
                    <button
                      aria-autocomplete="none"
                      aria-expanded="false"
                      aria-label="Category"
                      data-size="default"
                      data-slot="select-trigger"
                      data-state="closed"
                      data-testid="skills-category-select"
                      dir="ltr"
                      role="combobox"
                      type="button"
                    >
                      <span
                        data-slot="select-value"
                      >
                        None
                      </span>
                      <svg
                        aria-hidden="true"
                        fill="none"
                        height="24"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        viewBox="0 0 24 24"
                        width="24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="m6 9 6 6 6-6"
                        />
                      </svg>
                    </button>
                    <p>
                      This skill is uncategorized. Assign a category for proper prompt ordering.
                    </p>
                  </div>
                  <fieldset
                    aria-label="Skill actions"
                  >
                    <button
                      aria-label="Save"
                      data-size="default"
                      data-slot="button"
                      data-variant="default"
                    >
                      Save
                    </button>
                    <button
                      aria-label="Delete"
                      data-size="default"
                      data-slot="button"
                      data-variant="destructive"
                    >
                      Delete
                    </button>
                    <button
                      aria-label="Duplicate"
                      data-size="default"
                      data-slot="button"
                      data-variant="outline"
                    >
                      Duplicate
                    </button>
                    <button
                      aria-label="Cancel"
                      data-size="default"
                      data-slot="button"
                      data-variant="ghost"
                    >
                      Cancel
                    </button>
                  </fieldset>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DocumentFragment>
    `);
  });

  it('should match inline snapshot for null skill (empty state)', () => {
    const { asFragment } = render(
      <SkillEditor
        {...buildProps({
          skill: null,
          onNameChange: vi.fn(),
          onPromptChange: vi.fn(),
          onCategoryChange: vi.fn(),
          onCommandPrefixChange: vi.fn(),
          onSave: vi.fn(),
          onDelete: vi.fn(),
          onDuplicate: vi.fn(),
          onCancel: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div>
          <p>
            Select a skill to edit, or create a new one.
          </p>
        </div>
      </DocumentFragment>
    `);
  });
});
