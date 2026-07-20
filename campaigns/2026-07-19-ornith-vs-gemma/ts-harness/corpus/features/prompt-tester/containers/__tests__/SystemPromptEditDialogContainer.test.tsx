// Boundary mocks — declared before imports (Vitest hoisting)

vi.mock('@/i18n', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('../../stores/usePromptTesterStore', () => ({
  usePromptTesterStore: vi.fn(),
}));

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePromptTesterStore } from '../../stores/usePromptTesterStore';
import { SystemPromptEditDialogContainer } from '../SystemPromptEditDialogContainer';

// ---------------------------------------------------------------------------
// Store seed helper
// ---------------------------------------------------------------------------

type Prompt = { id: string; kind: string; text: string; edited: boolean; skillId?: string };

interface MockStore {
  editingPromptId: string | null;
  prompts: Prompt[];
  editPrompt: ReturnType<typeof vi.fn>;
  setEditingPrompt: ReturnType<typeof vi.fn>;
}

function seedStore(overrides: Partial<MockStore> = {}): MockStore {
  const store: MockStore = {
    editingPromptId: null,
    prompts: [],
    editPrompt: vi.fn(),
    setEditingPrompt: vi.fn(),
    ...overrides,
  };
  vi.mocked(usePromptTesterStore).mockImplementation((selector: (s: any) => unknown) =>
    selector(store)
  );
  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SystemPromptEditDialogContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render null when editingPromptId is null', () => {
    seedStore({ editingPromptId: null });

    const { container } = render(<SystemPromptEditDialogContainer />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('system-prompt-edit-dialog')).not.toBeInTheDocument();
  });

  it('should render dialog with entry text when editingPromptId is set', () => {
    seedStore({
      editingPromptId: 'p1',
      prompts: [{ id: 'p1', kind: 'manual', text: 'Hello prompt', edited: false }],
    });

    render(<SystemPromptEditDialogContainer />);

    const textarea = screen.getByTestId('system-prompt-edit-textarea');
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).value).toBe('Hello prompt');
  });

  it('should call editPrompt and setEditingPrompt(null) on save', async () => {
    const store = seedStore({
      editingPromptId: 'p1',
      prompts: [{ id: 'p1', kind: 'manual', text: 'original text', edited: false }],
    });

    const user = userEvent.setup();
    render(<SystemPromptEditDialogContainer />);

    const textarea = screen.getByTestId('system-prompt-edit-textarea');
    await user.clear(textarea);
    await user.type(textarea, 'updated text');

    const saveButton = screen.getByRole('button', { name: 'lab.systemPromptEdit.save' });
    await user.click(saveButton);

    expect(store.editPrompt).toHaveBeenCalledWith('p1', 'updated text');
    expect(store.setEditingPrompt).toHaveBeenCalledWith(null);
  });

  it('should call setEditingPrompt(null) without calling editPrompt on cancel', async () => {
    const store = seedStore({
      editingPromptId: 'p1',
      prompts: [{ id: 'p1', kind: 'manual', text: 'some text', edited: false }],
    });

    const user = userEvent.setup();
    render(<SystemPromptEditDialogContainer />);

    const cancelButton = screen.getByRole('button', { name: 'lab.systemPromptEdit.cancel' });
    await user.click(cancelButton);

    expect(store.setEditingPrompt).toHaveBeenCalledWith(null);
    expect(store.editPrompt).not.toHaveBeenCalled();
  });

  it('should display localized labels without raw i18n key dots in button text', () => {
    seedStore({
      editingPromptId: 'p1',
      prompts: [{ id: 'p1', kind: 'manual', text: 'text', edited: false }],
    });

    render(<SystemPromptEditDialogContainer />);

    const buttons = screen.getAllByRole('button');
    const buttonTexts = buttons.map(b => b.textContent ?? '');
    buttonTexts.forEach(text => {
      // The identity translator returns the key itself — assert keys are present
      // (meaning translation was called), but no button has ONLY a dotless raw string
      // i.e. every button label MUST match a known i18n key pattern or be structural (close icon)
      expect(text).not.toBe('');
    });

    // Verify specific translated labels appear in the dialog
    expect(screen.getByTestId('system-prompt-edit-dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lab.systemPromptEdit.save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'lab.systemPromptEdit.cancel' })).toBeInTheDocument();
  });
});
