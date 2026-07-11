import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunResult } from '../shared/types';

vi.mock('./runner', () => ({
  runAgentLoop: vi.fn(),
  emptySpecResult: vi.fn((agentType: string, targetFiles: readonly string[]) => ({
    status: 'local-exhausted',
    agentType,
    touchedFiles: targetFiles,
    finalRung: 'ollama',
    failureClass: 'empty-spec',
    escalated: true,
    fallbackSanctioned: false,
    attempts: 1,
    redObserved: false,
    greenObserved: false,
    modelId: 'unknown',
    targetFileCount: targetFiles.length,
    error: 'empty-spec: nav bundle missing/corrupt or no target files',
  })),
}));

vi.mock('node:fs/promises', () => {
  const readFile = vi.fn();
  return { default: { readFile }, readFile };
});

const { runAgentLoop } = await import('./runner');
const runAgentLoopMock = vi.mocked(runAgentLoop);

const { readFile } = await import('node:fs/promises');
const readFileMock = vi.mocked(readFile);

import type { TaskSpec } from '../execution/executor';
import {
  extractPlanRows,
  extractRequirementDetails,
  extractSpecExcerpts,
  extractTaskStatement,
  runTask,
  type RunTaskInput
} from './runTask';

const excerpt = (text: string): { readonly anchor: string; readonly text: string } => ({
  anchor: 'x',
  text,
});

const navJson = (texts: readonly string[]): string =>
  JSON.stringify({ specExcerpts: texts.map(excerpt) });

// A minimal bundle that scopes one target file, so the empty-spec guard does not
// fire and runTask proceeds into runAgentLoop. Used as the default for tests that
// assert spec-threading / forwarding behaviour (not the empty-spec hard-stop).
const TARGET_SOURCE = { path: 'src/a.ts', sha: 'x' };
const navWithTarget = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ sources: [TARGET_SOURCE], ...extra });

const completedResult: AgentRunResult = {
  status: 'completed',
  agentType: 'code-logic-writer',
  touchedFiles: ['a.ts'],
  finalRung: 'ollama',
  escalated: false,
  fallbackSanctioned: false,
  attempts: 1,
  redObserved: false,
  greenObserved: false,
  modelId: 'qwen2.5-coder:7b',
};

const makeInput = (overrides: Partial<RunTaskInput> = {}): RunTaskInput => ({
  agentType: 'code-logic-writer',
  navBundle: 'specs/branch/nav/T001.json',
  mode: 'impl',
  ...overrides,
});

describe('runTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runAgentLoopMock.mockResolvedValue(completedResult);
    readFileMock.mockResolvedValue(navWithTarget());
  });

  it('should resolve an AgentRunResult when input is valid', async () => {
    const result = await runTask(makeInput());

    expect(result).toEqual(completedResult);
  });

  it('should forward to runAgentLoop without throwing (footprint enforced inside the loop)', async () => {
    const input = makeInput({ agentType: 'unknown-agent' as RunTaskInput['agentType'] });

    await expect(runTask(input)).resolves.toEqual(completedResult);
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
  });

  it('should return a JSON-serializable result for the process boundary', async () => {
    const result = await runTask(makeInput());

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('should surface local-exhausted status to the caller unchanged', async () => {
    runAgentLoopMock.mockResolvedValue({ ...completedResult, status: 'local-exhausted' });

    const result = await runTask(makeInput());

    expect(result.status).toBe('local-exhausted');
  });

  it('should resolve targetFiles from the nav bundle specExcerpts', async () => {
    readFileMock.mockResolvedValue(
      navJson(['| `NEW:seam` | `tools/agentic-code-runner/src/runTask.ts` | new |'])
    );

    await runTask(makeInput());

    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.targetFiles).toContain('tools/agentic-code-runner/src/runTask.ts');
  });

  it('should forward an over-limit footprint to runAgentLoop (enforced inside the loop)', async () => {
    readFileMock.mockResolvedValue(
      navJson(['| a | `src/a.ts` | new |', '| b | `src/b.ts` | new |', '| c | `src/c.ts` | new |'])
    );

    await expect(runTask(makeInput())).resolves.toEqual(completedResult);
    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.targetFiles.length).toBe(3);
  });

  it('should hard-stop with empty-spec when a valid bundle scopes zero target files', async () => {
    readFileMock.mockResolvedValue(navJson([]));

    const result = await runTask(makeInput());

    expect(result.failureClass).toBe('empty-spec');
    expect(result.status).toBe('local-exhausted');
    expect(result.fallbackSanctioned).toBe(false);
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it('should thread existingTests from the nav bundle into the spec', async () => {
    readFileMock.mockResolvedValue(
      navWithTarget({
        existingTests: [
          { path: 'src/x.test.ts', describeItTree: ['describe X'], preamble: 'p' },
        ],
      })
    );

    await runTask(makeInput());

    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.existingTests).toEqual([
      { path: 'src/x.test.ts', describeItTree: ['describe X'] },
    ]);
  });

  it('should hard-stop with empty-spec when the nav bundle is unreadable/unparseable', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    const result = await runTask(makeInput());

    expect(result.failureClass).toBe('empty-spec');
    expect(result.status).toBe('local-exhausted');
    expect(result.escalated).toBe(true);
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it('should still run a normal bundle with target files (no false empty-spec trigger)', async () => {
    readFileMock.mockResolvedValue(navWithTarget());

    const result = await runTask(makeInput());

    expect(result).toEqual(completedResult);
    expect(runAgentLoopMock).toHaveBeenCalledTimes(1);
  });
});

describe('extractTargetFiles', () => {
  it('should deduplicate identical planContext entries and return a single path', async () => {
    const { extractTargetFiles } = await import('./runTask');
    const bundle = {
      planContext: [
        { file: 'src/features/prompt-tester/stores/usePromptTesterStore.ts', row: 'A' },
        { file: 'src/features/prompt-tester/stores/usePromptTesterStore.ts', row: 'B' },
      ],
    };

    const result = extractTargetFiles(bundle);

    expect(result).toEqual(['src/features/prompt-tester/stores/usePromptTesterStore.ts']);
  });

  it('should return only .ts paths from sources, excluding .json and absolute paths', async () => {
    const { extractTargetFiles } = await import('./runTask');
    const bundle = {
      sources: [
        { path: 'src/features/chat/stores/useChatStore.ts', sha: 'abc' },
        { path: 'specs/045/task-dag/nav/T011.json', sha: 'def' },
        { path: '/home/dev/work/dippe/AiChatney/src/features/chat/types.ts', sha: 'ghi' },
      ],
    };

    const result = extractTargetFiles(bundle);

    expect(result).toEqual(['src/features/chat/stores/useChatStore.ts']);
  });

  it('should fall back to specExcerpts heuristic when planContext and sources are absent', async () => {
    const { extractTargetFiles } = await import('./runTask');
    const bundle = {
      specExcerpts: [{ anchor: 'FR-1', text: 'Edit `path/x.ts` to add feature' }],
    };

    const result = extractTargetFiles(bundle);

    expect(result).toEqual(['path/x.ts']);
  });
});

describe('extractExistingTests', () => {
  it('should map a well-formed bundle and drop the preamble', async () => {
    const { extractExistingTests } = await import('./runTask');
    const bundle = {
      existingTests: [
        {
          path: 'src/x.test.ts',
          describeItTree: ['describe X', '  it does Y'],
          preamble: 'imports + helpers',
        },
      ],
    };

    const result = extractExistingTests(bundle);

    expect(result).toEqual([
      { path: 'src/x.test.ts', describeItTree: ['describe X', '  it does Y'] },
    ]);
  });

  it('should return an empty array when existingTests is absent', async () => {
    const { extractExistingTests } = await import('./runTask');

    expect(extractExistingTests({})).toEqual([]);
  });

  it('should return an empty array for a null bundle', async () => {
    const { extractExistingTests } = await import('./runTask');

    expect(extractExistingTests(null)).toEqual([]);
  });

  it('should return an empty array when existingTests is not an array', async () => {
    const { extractExistingTests } = await import('./runTask');

    expect(extractExistingTests({ existingTests: 'nope' })).toEqual([]);
  });

  it('should filter entries with a non-string path or non-string-array tree', async () => {
    const { extractExistingTests } = await import('./runTask');
    const bundle = {
      existingTests: [
        { path: 42, describeItTree: ['ok'] },
        { path: 'good.test.ts', describeItTree: ['a', 'b'] },
        { path: 'bad.test.ts', describeItTree: [1, 2] },
        { path: 'no-tree.test.ts' },
      ],
    };

    const result = extractExistingTests(bundle);

    expect(result).toEqual([{ path: 'good.test.ts', describeItTree: ['a', 'b'] }]);
  });
});

describe('extractCollaborators', () => {
  it('should return empty signatures and null siblingBody when collaborators is absent', async () => {
    const { extractCollaborators } = await import('./runTask');

    expect(extractCollaborators({})).toEqual({ signatures: [], siblingBody: null, typeShapes: [] });
  });

  it('should return empty signatures and null siblingBody for a null bundle', async () => {
    const { extractCollaborators } = await import('./runTask');

    expect(extractCollaborators(null)).toEqual({ signatures: [], siblingBody: null, typeShapes: [] });
  });

  it('should return empty signatures and null siblingBody when collaborators is not an object', async () => {
    const { extractCollaborators } = await import('./runTask');

    expect(extractCollaborators({ collaborators: 'bad' })).toEqual({
      signatures: [],
      siblingBody: null,
      typeShapes: [],
    });
  });

  it('should parse a valid collaborators block with signatures and siblingBody', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [{ name: 'persistActiveRun', signature: '(): Promise<void>' }],
        siblingBody: { name: 'getEvalComparisonPrompt', body: 'getEvalComparisonPrompt: () => {}' },
      },
    };

    const result = extractCollaborators(bundle);

    expect(result).toEqual({
      signatures: [{ name: 'persistActiveRun', signature: '(): Promise<void>' }],
      siblingBody: { name: 'getEvalComparisonPrompt', body: 'getEvalComparisonPrompt: () => {}' },
      typeShapes: [],
    });
  });

  it('should return empty signatures and null siblingBody when signatures is absent', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = { collaborators: { siblingBody: null } };

    const result = extractCollaborators(bundle);

    expect(result).toEqual({ signatures: [], siblingBody: null, typeShapes: [] });
  });

  it('should parse typeShapes entries when present', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [],
        siblingBody: null,
        typeShapes: [
          { name: 'ComparisonRequest', shape: '{ userPrompt: string }' },
          { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }' },
        ],
      },
    };

    const result = extractCollaborators(bundle);

    expect(result.typeShapes).toEqual([
      { name: 'ComparisonRequest', shape: '{ userPrompt: string }' },
      { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }' },
    ]);
  });

  it('should parse the optional importPath when present and omit it when absent or invalid', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [],
        siblingBody: null,
        typeShapes: [
          {
            name: 'ComparisonRequest',
            shape: '{ userPrompt: string }',
            importPath: '@/domain/comparison',
          },
          { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }', importPath: '' },
          { name: 'Plain', shape: '{ a: string }', importPath: 42 },
        ],
      },
    };

    const result = extractCollaborators(bundle);

    expect(result.typeShapes).toEqual([
      {
        name: 'ComparisonRequest',
        shape: '{ userPrompt: string }',
        importPath: '@/domain/comparison',
      },
      { name: 'EvalComparisonDTO', shape: '{ winnerCellId: string }' },
      { name: 'Plain', shape: '{ a: string }' },
    ]);
  });

  it('should default typeShapes to an empty array when absent', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = { collaborators: { signatures: [], siblingBody: null } };

    expect(extractCollaborators(bundle).typeShapes).toEqual([]);
  });

  it('should filter malformed typeShapes entries missing name or shape string fields', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [],
        siblingBody: null,
        typeShapes: [
          { name: 'Good', shape: '{ a: string }' },
          { name: 42, shape: '{ a: string }' },
          { name: 'Bad', shape: 99 },
          { shape: '{ a: string }' },
          { name: 'Empty', shape: '' },
        ],
      },
    };

    const result = extractCollaborators(bundle);

    expect(result.typeShapes).toEqual([{ name: 'Good', shape: '{ a: string }' }]);
  });

  it('should default typeShapes to an empty array when it is not an array', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = { collaborators: { signatures: [], siblingBody: null, typeShapes: 'bad' } };

    expect(extractCollaborators(bundle).typeShapes).toEqual([]);
  });

  it('should drop malformed signature entries missing name or signature string fields', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [
          { name: 'good', signature: '(): void' },
          { name: 42, signature: '(): void' },
          { name: 'bad', signature: 99 },
          { signature: '(): void' },
        ],
        siblingBody: null,
      },
    };

    const result = extractCollaborators(bundle);

    expect(result.signatures).toEqual([{ name: 'good', signature: '(): void' }]);
  });

  it('should accept null siblingBody explicitly', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: { signatures: [], siblingBody: null },
    };

    expect(extractCollaborators(bundle).siblingBody).toBeNull();
  });

  it('should reject a siblingBody missing the name field', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [],
        siblingBody: { body: 'fn: () => {}' },
      },
    };

    expect(extractCollaborators(bundle).siblingBody).toBeNull();
  });

  it('should reject a siblingBody missing the body field', async () => {
    const { extractCollaborators } = await import('./runTask');
    const bundle = {
      collaborators: {
        signatures: [],
        siblingBody: { name: 'fn' },
      },
    };

    expect(extractCollaborators(bundle).siblingBody).toBeNull();
  });

  it('should thread collaborators from the nav bundle into the spec', async () => {
    readFileMock.mockResolvedValue(
      navWithTarget({
        collaborators: {
          signatures: [{ name: 'myFn', signature: '(x: string): void' }],
          siblingBody: null,
        },
      })
    );

    await runTask(makeInput());

    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.collaborators).toEqual({
      signatures: [{ name: 'myFn', signature: '(x: string): void' }],
      siblingBody: null,
      typeShapes: [],
    });
  });
});

describe('runTask RUNNER_RULES_PATH bridge', () => {
  let originalRulesPath: string | undefined;

  beforeEach(() => {
    originalRulesPath = process.env.RUNNER_RULES_PATH;
    vi.clearAllMocks();
    runAgentLoopMock.mockResolvedValue(completedResult);
    readFileMock.mockResolvedValue(navJson([]));
  });

  afterEach(() => {
    if (originalRulesPath === undefined) {
      delete process.env.RUNNER_RULES_PATH;
    } else {
      process.env.RUNNER_RULES_PATH = originalRulesPath;
    }
  });

  it('should set RUNNER_RULES_PATH env var when input carries rulesPath', async () => {
    const input = makeInput({ rulesPath: '/abs/r.md' });

    await runTask(input);

    expect(process.env.RUNNER_RULES_PATH).toBe('/abs/r.md');
  });

  it('should not clobber a pre-set RUNNER_RULES_PATH when input has no rulesPath', async () => {
    process.env.RUNNER_RULES_PATH = 'PRESET';
    const input = makeInput();

    await runTask(input);

    expect(process.env.RUNNER_RULES_PATH).toBe('PRESET');
  });
});

// ---------------------------------------------------------------------------
// PURE: extractTaskStatement
// ---------------------------------------------------------------------------

describe('extractTaskStatement', () => {
  it('should return the string value when taskStatement is present in navJson', () => {
    // Arrange
    const navJson = { taskStatement: 'Add runEvalComparison(runId) to the eval store.' };

    // Act
    const result = extractTaskStatement(navJson);

    // Assert
    expect(result).toBe('Add runEvalComparison(runId) to the eval store.');
  });

  it('should return empty string when taskStatement is absent', () => {
    // Arrange
    const navJson = { specExcerpts: [] };

    // Act
    const result = extractTaskStatement(navJson);

    // Assert
    expect(result).toBe('');
  });

  it('should return empty string when taskStatement is not a string', () => {
    // Arrange
    const navJson = { taskStatement: 42 };

    // Act
    const result = extractTaskStatement(navJson);

    // Assert
    expect(result).toBe('');
  });

  it('should return empty string when navJson is null', () => {
    // Act
    const result = extractTaskStatement(null);

    // Assert
    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// PURE: extractSpecExcerpts
// ---------------------------------------------------------------------------

describe('extractSpecExcerpts', () => {
  it('should extract text strings from a valid specExcerpts array', () => {
    // Arrange
    const bundle = {
      specExcerpts: [
        { anchor: 'FR-1', text: 'Add extractSpecExcerpts to runTask.' },
        { anchor: 'FR-2', text: 'Wire it into toTaskSpec.' },
      ],
    };

    // Act
    const result = extractSpecExcerpts(bundle);

    // Assert
    expect(result).toEqual([
      'Add extractSpecExcerpts to runTask.',
      'Wire it into toTaskSpec.',
    ]);
  });

  it('should return [] when specExcerpts is absent', () => {
    // Arrange
    const bundle = { taskStatement: 'something' };

    // Act / Assert
    expect(extractSpecExcerpts(bundle)).toEqual([]);
  });

  it('should return [] when navJson is null', () => {
    // Act / Assert
    expect(extractSpecExcerpts(null)).toEqual([]);
  });

  it('should return [] when specExcerpts is not an array', () => {
    // Arrange
    const bundle = { specExcerpts: 'bad' };

    // Act / Assert
    expect(extractSpecExcerpts(bundle)).toEqual([]);
  });

  it('should skip entries where text is empty after trimming', () => {
    // Arrange
    const bundle = {
      specExcerpts: [
        { anchor: 'a', text: '   ' },
        { anchor: 'b', text: 'Keep this.' },
      ],
    };

    // Act
    const result = extractSpecExcerpts(bundle);

    // Assert
    expect(result).toEqual(['Keep this.']);
  });

  it('should skip entries where text is not a string', () => {
    // Arrange
    const bundle = {
      specExcerpts: [
        { anchor: 'a', text: 42 },
        { anchor: 'b', text: null },
        { anchor: 'c', text: 'valid' },
        { anchor: 'd' },
      ],
    };

    // Act
    const result = extractSpecExcerpts(bundle);

    // Assert
    expect(result).toEqual(['valid']);
  });

  it('should thread specExcerpts into the spec built by runTask', async () => {
    // Arrange
    readFileMock.mockResolvedValue(
      navWithTarget({
        specExcerpts: [
          { anchor: 'FR-1', text: 'Implement extractSpecExcerpts.' },
        ],
      })
    );

    // Act
    await runTask(makeInput());

    // Assert
    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.specExcerpts).toEqual(['Implement extractSpecExcerpts.']);
  });
});

// ---------------------------------------------------------------------------
// PURE: extractRequirementDetails
// ---------------------------------------------------------------------------

describe('extractRequirementDetails', () => {
  it('should compose align, outcome, and acceptance lines when all fields present', () => {
    // Arrange
    const bundle = {
      requirements: [
        {
          id: 'R-1',
          align: 'FR-01',
          outcome: 'The system persists the result.',
          acceptance: { positive: 'result stored', negative: 'no duplicate' },
        },
      ],
    };

    // Act
    const result = extractRequirementDetails(bundle);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Requirement: FR-01');
    expect(result[0]).toContain('Outcome: The system persists the result.');
    expect(result[0]).toContain('Accept(+): result stored');
    expect(result[0]).toContain('Accept(-): no duplicate');
  });

  it('should skip missing fields and still compose a partial entry', () => {
    // Arrange
    const bundle = {
      requirements: [{ id: 'R-2', align: 'FR-02' }],
    };

    // Act
    const result = extractRequirementDetails(bundle);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Requirement: FR-02');
    expect(result[0]).not.toContain('Outcome:');
    expect(result[0]).not.toContain('Accept');
  });

  it('should skip entries that yield nothing (no align/outcome/acceptance)', () => {
    // Arrange
    const bundle = {
      requirements: [{ id: 'R-3' }, { id: 'R-4', align: 'FR-04' }],
    };

    // Act
    const result = extractRequirementDetails(bundle);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('FR-04');
  });

  it('should return [] when requirements is absent', () => {
    // Arrange / Act / Assert
    expect(extractRequirementDetails({})).toEqual([]);
  });

  it('should return [] when navJson is null', () => {
    // Act / Assert
    expect(extractRequirementDetails(null)).toEqual([]);
  });

  it('should return [] when requirements is not an array', () => {
    // Arrange / Act / Assert
    expect(extractRequirementDetails({ requirements: 'bad' })).toEqual([]);
  });

  it('should include only acceptance.positive when negative is absent', () => {
    // Arrange
    const bundle = {
      requirements: [{ id: 'R-5', align: 'FR-05', acceptance: { positive: 'pass case' } }],
    };

    // Act
    const result = extractRequirementDetails(bundle);

    // Assert
    expect(result[0]).toContain('Accept(+): pass case');
    expect(result[0]).not.toContain('Accept(-)');
  });

  it('should thread requirementDetails into the spec built by runTask', async () => {
    // Arrange
    readFileMock.mockResolvedValue(
      navWithTarget({
        requirements: [{ id: 'R-1', align: 'FR-01', outcome: 'persists result' }],
      })
    );

    // Act
    await runTask(makeInput());

    // Assert
    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.requirementDetails).toBeDefined();
    expect(spec.requirementDetails![0]).toContain('FR-01');
  });
});

// ---------------------------------------------------------------------------
// PURE: extractPlanRows
// ---------------------------------------------------------------------------

describe('extractPlanRows', () => {
  it('should return non-empty row strings from planContext', () => {
    // Arrange
    const bundle = {
      planContext: [
        { file: 'src/a.ts', row: '| src/a.ts | store | Feature A |' },
        { file: 'src/b.ts', row: '| src/b.ts | service | Feature B |' },
      ],
    };

    // Act
    const result = extractPlanRows(bundle);

    // Assert
    expect(result).toEqual([
      '| src/a.ts | store | Feature A |',
      '| src/b.ts | service | Feature B |',
    ]);
  });

  it('should return [] when planContext is absent', () => {
    // Arrange / Act / Assert
    expect(extractPlanRows({})).toEqual([]);
  });

  it('should return [] when navJson is null', () => {
    // Act / Assert
    expect(extractPlanRows(null)).toEqual([]);
  });

  it('should skip entries with no row or empty row', () => {
    // Arrange
    const bundle = {
      planContext: [
        { file: 'src/a.ts' },
        { file: 'src/b.ts', row: '   ' },
        { file: 'src/c.ts', row: '| src/c.ts | lib | Feature C |' },
      ],
    };

    // Act
    const result = extractPlanRows(bundle);

    // Assert
    expect(result).toEqual(['| src/c.ts | lib | Feature C |']);
  });

  it('should deduplicate identical rows', () => {
    // Arrange
    const bundle = {
      planContext: [
        { file: 'src/a.ts', row: '| src/a.ts | store | Feature A |' },
        { file: 'src/a.ts', row: '| src/a.ts | store | Feature A |' },
      ],
    };

    // Act
    const result = extractPlanRows(bundle);

    // Assert
    expect(result).toEqual(['| src/a.ts | store | Feature A |']);
  });

  it('should thread planRows into the spec built by runTask', async () => {
    // Arrange
    readFileMock.mockResolvedValue(
      JSON.stringify({
        planContext: [{ file: 'src/a.ts', row: '| src/a.ts | store | Feature A |' }],
      })
    );

    // Act
    await runTask(makeInput());

    // Assert
    const spec = runAgentLoopMock.mock.calls[0]?.[0] as TaskSpec;
    expect(spec.planRows).toEqual(['| src/a.ts | store | Feature A |']);
  });
});
