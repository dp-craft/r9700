import { beforeEach, describe, expect, it, vi } from 'vitest';

// Boundary mocks — hoisted before imports (Vitest hoisting)

vi.mock('@/db/archivedRuns', () => ({
  archiveRun: vi.fn(),
}));

vi.mock('@/services/llm/stream', () => ({
  streamChat: vi.fn(),
}));

vi.mock('@/db/appSettings', () => ({
  getLabSectionCollapse: vi.fn().mockResolvedValue({}),
  putLabSectionCollapse: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/labRuns', () => ({
  getAllLabRuns: vi.fn().mockResolvedValue([]),
  putLabRun: vi.fn().mockResolvedValue(undefined),
  deleteLabRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/db/prompts', () => ({
  capturePrompt: vi.fn().mockResolvedValue(undefined),
  getAllPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/skills/lib/derivePickerHistory', () => ({
  derivePickerHistory: vi.fn().mockReturnValue([]),
}));

import { usePromptTesterStore } from '../usePromptTesterStore';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptTesterStore — addSystemPromptToActiveRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should add one custom-kind PromptEntry with edited=false when kind is container', () => {
    // Arrange
    const { addSystemPromptToActiveRun } = usePromptTesterStore.getState();
    const before = usePromptTesterStore.getState().prompts;
    expect(before).toHaveLength(0);

    // Act
    addSystemPromptToActiveRun({ kind: 'container', containerId: 'c1', prompt: 'composed text' });

    // Assert
    const { prompts } = usePromptTesterStore.getState();
    expect(prompts).toHaveLength(1);
    const entry = prompts[0];
    expect(entry.kind).toBe('custom');
    expect(entry.text).toBe('composed text');
    expect(entry.edited).toBe(false);
  });

  it('should assign a unique id to the added entry', () => {
    // Arrange
    const { addSystemPromptToActiveRun } = usePromptTesterStore.getState();

    // Act
    addSystemPromptToActiveRun({ kind: 'container', containerId: 'c1', prompt: 'first' });
    addSystemPromptToActiveRun({ kind: 'container', containerId: 'c2', prompt: 'second' });

    // Assert
    const { prompts } = usePromptTesterStore.getState();
    expect(prompts).toHaveLength(2);
    expect(prompts[0].id).not.toBe(prompts[1].id);
  });
});

describe('usePromptTesterStore — setEditingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should set editingPromptId to the given id when called with a string', () => {
    // Act
    usePromptTesterStore.getState().setEditingPrompt('prompt-1');

    // Assert
    expect(usePromptTesterStore.getState().editingPromptId).toBe('prompt-1');
  });

  it('should clear editingPromptId when called with null', () => {
    // Arrange
    usePromptTesterStore.getState().setEditingPrompt('prompt-1');
    expect(usePromptTesterStore.getState().editingPromptId).toBe('prompt-1');

    // Act
    usePromptTesterStore.getState().setEditingPrompt(null);

    // Assert
    expect(usePromptTesterStore.getState().editingPromptId).toBeNull();
  });
});

describe('usePromptTesterStore — editPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePromptTesterStore.setState(usePromptTesterStore.getInitialState());
  });

  it('should update the entry text and set edited=true for a custom-kind entry', () => {
    // Arrange
    usePromptTesterStore.getState().addSystemPromptToActiveRun({
      kind: 'container',
      containerId: 'c1',
      prompt: 'original text',
    });
    const { prompts } = usePromptTesterStore.getState();
    const entryId = prompts[0].id;
    expect(prompts[0].edited).toBe(false);

    // Act
    usePromptTesterStore.getState().editPrompt(entryId, 'updated text');

    // Assert
    const updated = usePromptTesterStore.getState().prompts[0];
    expect(updated.text).toBe('updated text');
    expect(updated.edited).toBe(true);
  });

  it('should set edited=true even when the entry already had edited=false', () => {
    // Arrange — skill kind starts with edited=false
    usePromptTesterStore.getState().addSystemPromptToActiveRun({
      kind: 'skill',
      skillId: 's1',
      name: 'My Skill',
      prompt: 'skill prompt',
    });
    const { prompts } = usePromptTesterStore.getState();
    const entryId = prompts[0].id;
    expect(prompts[0].edited).toBe(false);

    // Act
    usePromptTesterStore.getState().editPrompt(entryId, 'overridden');

    // Assert
    const updated = usePromptTesterStore.getState().prompts[0];
    expect(updated.edited).toBe(true);
    expect(updated.text).toBe('overridden');
  });

  it('should not modify other entries when editing a specific entry', () => {
    // Arrange
    usePromptTesterStore.getState().addSystemPromptToActiveRun({
      kind: 'container',
      containerId: 'c1',
      prompt: 'first',
    });
    usePromptTesterStore.getState().addSystemPromptToActiveRun({
      kind: 'container',
      containerId: 'c2',
      prompt: 'second',
    });
    const { prompts } = usePromptTesterStore.getState();
    const firstId = prompts[0].id;

    // Act
    usePromptTesterStore.getState().editPrompt(firstId, 'edited first');

    // Assert
    const state = usePromptTesterStore.getState();
    expect(state.prompts[0].text).toBe('edited first');
    expect(state.prompts[1].text).toBe('second');
    expect(state.prompts[1].edited).toBe(false);
  });

  it('should be a no-op when the prompt id does not exist', () => {
    // Arrange
    usePromptTesterStore.getState().addSystemPromptToActiveRun({
      kind: 'container',
      containerId: 'c1',
      prompt: 'original',
    });
    const before = usePromptTesterStore.getState().prompts[0];

    // Act
    usePromptTesterStore.getState().editPrompt('nonexistent-id', 'should not apply');

    // Assert
    const after = usePromptTesterStore.getState().prompts[0];
    expect(after.text).toBe(before.text);
    expect(after.edited).toBe(before.edited);
  });
});
