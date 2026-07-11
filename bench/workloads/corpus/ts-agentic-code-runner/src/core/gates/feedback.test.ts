import { describe, expect, it } from 'vitest';

import type { Conclusion, Ledger } from './feedback';
import {
  appendConclusion,
  buildDriveMessages,
  buildFeedbackMessage,
  extractConclusion,
  failureSignature,
  FEEDBACK_MAX_OUTPUT_CHARS,
  isNoProgress,
  isTransformError,
  LEDGER_CAP,
  localizeOutput
} from './feedback';
import type { GateFailure } from './gates';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFailure = (
  gate: GateFailure['gate'],
  output: string,
  message = 'gate failed'
): GateFailure => ({ gate, message, output });

const makeConclusion = (
  attempt: number,
  stage: 'test' | 'code',
  note = `note${attempt}`
): Conclusion => ({ attempt, stage, signature: `sig${attempt}`, note });

// ---------------------------------------------------------------------------
// isTransformError
// ---------------------------------------------------------------------------

describe('isTransformError', () => {
  it('should return true for an esbuild Transform failed + ERROR: Unexpected sample', () => {
    const output =
      'Error: Transform failed with 1 error:\n/workspace/usePromptTesterStore.test.ts:47:4: ERROR: Unexpected ","';

    expect(isTransformError(output)).toBe(true);
  });

  it('should return true when output contains only SyntaxError', () => {
    const output = 'SyntaxError: Unexpected token }';

    expect(isTransformError(output)).toBe(true);
  });

  it('should return true when output contains Failed to parse', () => {
    const output = 'Failed to parse /src/foo.test.ts at line 12';

    expect(isTransformError(output)).toBe(true);
  });

  it('should return true when output contains ERROR: Expected', () => {
    const output = 'ERROR: Expected ";" but found "{"';

    expect(isTransformError(output)).toBe(true);
  });

  it('should return true when output contains ERROR: Unterminated', () => {
    const output = 'ERROR: Unterminated string literal';

    expect(isTransformError(output)).toBe(true);
  });

  it('should return false for a normal vitest AssertionError output', () => {
    const output =
      'AssertionError: expected 1 to be 2\n  at Object.<anonymous> (src/foo.test.ts:10:5)';

    expect(isTransformError(output)).toBe(false);
  });

  it('should return false for a normal "expected … to be …" assertion failure', () => {
    const output = 'Error: expected "hello" to be "world"';

    expect(isTransformError(output)).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(isTransformError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// failureSignature
// ---------------------------------------------------------------------------

describe('failureSignature', () => {
  it('should produce equal signatures for the same failure with different durations', () => {
    const outputA = 'FAIL src/foo.test.ts\n✗ should work (12ms)\nExpected true';
    const outputB = 'FAIL src/foo.test.ts\n✗ should work (340ms)\nExpected true';

    const sigA = failureSignature(makeFailure('test', outputA));
    const sigB = failureSignature(makeFailure('test', outputB));

    expect(sigA).toBe(sigB);
  });

  it('should produce equal signatures for the same failure with different timestamps', () => {
    const outputA = 'error TS2345 at 10:23:45 — foo.ts';
    const outputB = 'error TS2345 at 18:01:02 — foo.ts';

    const sigA = failureSignature(makeFailure('tsc', outputA));
    const sigB = failureSignature(makeFailure('tsc', outputB));

    expect(sigA).toBe(sigB);
  });

  it('should produce different signatures when the failing-test text differs', () => {
    const outputA = 'FAIL src/foo.test.ts\nExpected "hello" but got "world"';
    const outputB = 'FAIL src/foo.test.ts\nExpected "hello" but got "universe"';

    const sigA = failureSignature(makeFailure('test', outputA));
    const sigB = failureSignature(makeFailure('test', outputB));

    expect(sigA).not.toBe(sigB);
  });

  it('should produce different signatures for the same output on different gates', () => {
    const output = 'FAIL some error line';

    const sigLint = failureSignature(makeFailure('lint', output));
    const sigTest = failureSignature(makeFailure('test', output));

    expect(sigLint).not.toBe(sigTest);
  });
});

// ---------------------------------------------------------------------------
// isNoProgress
// ---------------------------------------------------------------------------

describe('isNoProgress', () => {
  it('should return true when current signature is already in history', () => {
    const history = ['test|FAIL foo', 'lint|error bar'];
    const current = 'test|FAIL foo';

    expect(isNoProgress(history, current)).toBe(true);
  });

  it('should return false when history is empty', () => {
    expect(isNoProgress([], 'test|FAIL foo')).toBe(false);
  });

  it('should return false when current signature is not in history', () => {
    const history = ['test|FAIL bar', 'tsc|error TS1234'];
    const current = 'test|FAIL completely-different';

    expect(isNoProgress(history, current)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackMessage
// ---------------------------------------------------------------------------

describe('buildFeedbackMessage', () => {
  it('should include the gate name in the feedback message', () => {
    const failure = makeFailure('lint', 'lint output here');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('lint');
  });

  it('should include the failure output in the feedback message', () => {
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('error TS2345: type mismatch');
  });

  it('should include "do NOT edit the test files" instruction when gate is test', () => {
    const failure = makeFailure('test', 'test output');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('do NOT edit the test files');
  });

  it('should not include the test-file instruction when gate is lint', () => {
    const failure = makeFailure('lint', 'lint output');

    const message = buildFeedbackMessage(failure);

    expect(message).not.toContain('do NOT edit the test files');
  });

  it('should not include the test-file instruction when gate is tsc', () => {
    const failure = makeFailure('tsc', 'tsc output');

    const message = buildFeedbackMessage(failure);

    expect(message).not.toContain('do NOT edit the test files');
  });

  it('should truncate output longer than FEEDBACK_MAX_OUTPUT_CHARS and include "[truncated]"', () => {
    const longOutput = 'x'.repeat(FEEDBACK_MAX_OUTPUT_CHARS + 500);
    const failure = makeFailure('test', longOutput);

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('[truncated]');
    expect(message.length).toBeLessThan(longOutput.length);
  });

  it('should not truncate output at or below FEEDBACK_MAX_OUTPUT_CHARS', () => {
    const exactOutput = 'y'.repeat(FEEDBACK_MAX_OUTPUT_CHARS);
    const failure = makeFailure('lint', exactOutput);

    const message = buildFeedbackMessage(failure);

    expect(message).not.toContain('[truncated]');
  });

  it('should permit editing the test file when the test gate output is a transform error', () => {
    const transformOutput =
      'Error: Transform failed with 1 error:\n/foo.test.ts:12:3: ERROR: Unexpected ","';
    const failure = makeFailure('test', transformOutput);

    const message = buildFeedbackMessage(failure);

    expect(message).not.toContain('do NOT edit the test files');
  });

  it('should include wording that allows test-file edits for a transform-error failure', () => {
    const transformOutput = 'SyntaxError: Unexpected token }';
    const failure = makeFailure('test', transformOutput);

    const message = buildFeedbackMessage(failure);

    // Must affirmatively permit editing the test file
    expect(message.toLowerCase()).toMatch(/fix.*(syntax|test file)/);
  });

  it('should still include "do NOT edit the test files" for a normal assertion failure on the test gate', () => {
    const assertionOutput = 'AssertionError: expected 1 to be 2';
    const failure = makeFailure('test', assertionOutput);

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('do NOT edit the test files');
  });
});

// ---------------------------------------------------------------------------
// localizeOutput
// ---------------------------------------------------------------------------

describe('localizeOutput', () => {
  it('should extract only lines matching the fail regex for the test gate', () => {
    const output = [
      'banner noise',
      'FAIL src/foo.test.ts',
      '  more noise',
      'Expected true but got false',
      'done',
    ].join('\n');

    const result = localizeOutput(makeFailure('test', output));

    expect(result).toContain('FAIL src/foo.test.ts');
    expect(result).toContain('Expected true but got false');
    expect(result).not.toContain('banner noise');
    expect(result).not.toContain('done');
  });

  it('should extract error TS lines for the tsc gate', () => {
    const output = [
      'tsc info line',
      'error TS2345: Argument of type string not assignable',
      'another info line',
    ].join('\n');

    const result = localizeOutput(makeFailure('tsc', output));

    expect(result).toContain('error TS2345');
    expect(result).not.toContain('tsc info line');
  });

  it('should return full output as-is for decomposition gate', () => {
    const output = 'src/foo.ts:10 — complexity 6 exceeds cap 5\nsrc/bar.ts:20 — complexity 8 exceeds cap 5';

    const result = localizeOutput(makeFailure('decomposition', output));

    expect(result).toBe(output);
  });

  it('should return full output as-is for functional-style gate', () => {
    const output = 'src/foo.ts:5 — for loop found\nsrc/bar.ts:8 — let declaration found';

    const result = localizeOutput(makeFailure('functional-style', output));

    expect(result).toBe(output);
  });

  it('should fall back to first N lines when no fail-regex lines match', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const output = lines.join('\n');

    const result = localizeOutput(makeFailure('lint', output));

    // falls back — result is shorter than full output or truncated
    expect(result.length).toBeLessThanOrEqual(output.length);
  });

  it('should cap output to FEEDBACK_MAX_OUTPUT_CHARS with truncation marker', () => {
    const manyFails = Array.from({ length: 200 }, (_, i) => `FAIL src/test${i}.ts`).join('\n');

    const result = localizeOutput(makeFailure('test', manyFails));

    // content ≤ cap + newline + truncation marker
    expect(result.length).toBeLessThanOrEqual(FEEDBACK_MAX_OUTPUT_CHARS + 1 + '…[truncated]…'.length);
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackMessage (localized + fix hints)
// ---------------------------------------------------------------------------

describe('buildFeedbackMessage fix hints', () => {
  it('should include a decomposition fix hint for decomposition gate', () => {
    const failure = makeFailure('decomposition', 'src/foo.ts:10 — complexity 6');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('Extract small helpers');
  });

  it('should include a functional-style fix hint for functional-style gate', () => {
    const failure = makeFailure('functional-style', 'src/foo.ts:5 — for loop found');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('.map()');
  });

  it('should include a tsc fix hint for tsc gate', () => {
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('type error');
  });

  it('should include a test fix hint for test gate', () => {
    const failure = makeFailure('test', 'FAIL src/foo.test.ts\nExpected true');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('failing assertion');
  });

  it('should include a lint fix hint for lint gate', () => {
    const failure = makeFailure('lint', 'error: some lint error');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('lint');
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackMessage (file-context directives — G2 kickoff/retry reconciliation)
// ---------------------------------------------------------------------------

describe('buildFeedbackMessage file-context directives', () => {
  it('should tell the model to resubmit the region via submit_region in slice context', () => {
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');

    const message = buildFeedbackMessage(failure, 'slice');

    expect(message).toContain('submit_region');
  });

  it('should not tell the model to read the current file state in slice context', () => {
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');

    const message = buildFeedbackMessage(failure, 'slice');

    expect(message).not.toContain('Read the current state');
  });

  it('should tell the model the preloaded source is current in preload context', () => {
    const failure = makeFailure('lint', 'some lint error');

    const message = buildFeedbackMessage(failure, 'preload');

    expect(message).toContain('preloaded source');
  });

  it('should not tell the model to read the current file state in preload context', () => {
    const failure = makeFailure('lint', 'some lint error');

    const message = buildFeedbackMessage(failure, 'preload');

    expect(message).not.toContain('Read the current state');
  });

  it('should tell the model to read the current file state in none context', () => {
    const failure = makeFailure('lint', 'some lint error');

    const message = buildFeedbackMessage(failure, 'none');

    expect(message).toContain('Read the current state');
  });

  it('should default to the none directive when no context is supplied', () => {
    const failure = makeFailure('lint', 'some lint error');

    const message = buildFeedbackMessage(failure);

    expect(message).toContain('Read the current state');
  });

  it('should apply the slice directive to a transform-error test failure too', () => {
    const failure = makeFailure('test', 'SyntaxError: Unexpected token }');

    const message = buildFeedbackMessage(failure, 'slice');

    expect(message).toContain('submit_region');
    expect(message).not.toContain('Read the current state');
  });
});

// ---------------------------------------------------------------------------
// appendConclusion
// ---------------------------------------------------------------------------

describe('appendConclusion', () => {
  it('should append a conclusion to an empty ledger', () => {
    // Arrange
    const ledger: Ledger = [];
    const c = makeConclusion(1, 'code');

    // Act
    const result = appendConclusion(ledger, c);

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]).toStrictEqual(c);
  });

  it('should preserve existing entries when below the cap', () => {
    // Arrange
    const ledger: Ledger = [makeConclusion(1, 'test'), makeConclusion(2, 'code')];
    const c = makeConclusion(3, 'test');

    // Act
    const result = appendConclusion(ledger, c);

    // Assert
    expect(result).toHaveLength(3);
    expect(result[2]).toStrictEqual(c);
  });

  it('should drop the oldest entry when appending beyond LEDGER_CAP', () => {
    // Arrange
    const full: Ledger = Array.from({ length: LEDGER_CAP }, (_, i) =>
      makeConclusion(i + 1, 'code')
    );
    const newest = makeConclusion(LEDGER_CAP + 1, 'code');

    // Act
    const result = appendConclusion(full, newest);

    // Assert
    expect(result).toHaveLength(LEDGER_CAP);
    expect(result[0].attempt).toBe(2);
    expect(result[result.length - 1]).toStrictEqual(newest);
  });

  it('should not mutate the original ledger', () => {
    // Arrange
    const ledger: Ledger = [makeConclusion(1, 'code')];

    // Act
    appendConclusion(ledger, makeConclusion(2, 'code'));

    // Assert
    expect(ledger).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildDriveMessages (ledger-based, stage-filtered)
// ---------------------------------------------------------------------------

describe('buildDriveMessages', () => {
  it('should return a single user message equal to the kickoff when ledger is empty', () => {
    // Arrange
    const kickoff = 'Write the implementation for feature X.';

    // Act
    const messages = buildDriveMessages(kickoff, [], 'code');

    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0]).toStrictEqual({ role: 'user', content: kickoff });
  });

  it('should return bare kickoff when no ledger entries match the requested stage', () => {
    // Arrange
    const kickoff = 'Write the implementation.';
    const ledger: Ledger = [makeConclusion(1, 'test')];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'code');

    // Assert
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe(kickoff);
  });

  it('should include matching-stage notes when ledger has entries for the stage', () => {
    // Arrange
    const kickoff = 'Write the implementation for feature X.';
    const note = 'Your previous attempt failed the lint gate.';
    const ledger: Ledger = [{ attempt: 1, stage: 'code', signature: 'lint|foo', note }];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'code');

    // Assert
    expect(messages).toHaveLength(1);
    const content = messages[0].content as string;
    expect(content).toContain(kickoff);
    expect(content).toContain(note);
  });

  it('should NOT include a test-stage conclusion in a code drive', () => {
    // Arrange
    const kickoff = 'Implement the feature.';
    const testNote = 'Test gate failed: AssertionError at line 10';
    const ledger: Ledger = [
      { attempt: 1, stage: 'test', signature: 'test|sig', note: testNote },
      { attempt: 2, stage: 'code', signature: 'code|sig', note: 'code note' },
    ];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'code');

    // Assert
    const content = messages[0].content as string;
    expect(content).not.toContain(testNote);
    expect(content).toContain('code note');
  });

  it('should NOT include a code-stage conclusion in a test drive', () => {
    // Arrange
    const kickoff = 'Write the tests.';
    const codeNote = 'TSC error TS2345 in implementation file';
    const ledger: Ledger = [
      { attempt: 1, stage: 'code', signature: 'tsc|sig', note: codeNote },
      { attempt: 2, stage: 'test', signature: 'test|sig', note: 'test note' },
    ];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'test');

    // Assert
    const content = messages[0].content as string;
    expect(content).not.toContain(codeNote);
    expect(content).toContain('test note');
  });

  it('should label each matching note with its attempt number and stage', () => {
    // Arrange
    const kickoff = 'Write code.';
    const ledger: Ledger = [{ attempt: 3, stage: 'code', signature: 'sig', note: 'some note' }];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'code');

    // Assert
    const content = messages[0].content as string;
    expect(content).toContain('Attempt 3');
    expect(content).toContain('code gate');
  });

  it('should join multiple matching notes in ledger order (newest last)', () => {
    // Arrange
    const kickoff = 'Write code.';
    const ledger: Ledger = [
      { attempt: 1, stage: 'code', signature: 'sig1', note: 'note-alpha' },
      { attempt: 2, stage: 'code', signature: 'sig2', note: 'note-beta' },
    ];

    // Act
    const messages = buildDriveMessages(kickoff, ledger, 'code');

    // Assert
    const content = messages[0].content as string;
    const posAlpha = content.indexOf('note-alpha');
    const posBeta = content.indexOf('note-beta');
    expect(posAlpha).toBeGreaterThanOrEqual(0);
    expect(posBeta).toBeGreaterThanOrEqual(0);
    expect(posAlpha).toBeLessThan(posBeta);
  });
});

// ---------------------------------------------------------------------------
// extractConclusion
// ---------------------------------------------------------------------------

describe('extractConclusion', () => {
  it('should use the summarize result when it returns a non-empty string', async () => {
    // Arrange
    const failure = makeFailure('lint', 'lint output here');
    const summarize = async (_f: GateFailure): Promise<string> => 'LLM summary of lint failure';

    // Act
    const conclusion = await extractConclusion(failure, 1, 'code', summarize);

    // Assert
    expect(conclusion.note).toBe('LLM summary of lint failure');
  });

  it('should fall back to buildFeedbackMessage when summarize is undefined', async () => {
    // Arrange
    const failure = makeFailure('lint', 'lint output here');
    const expected = buildFeedbackMessage(failure);

    // Act
    const conclusion = await extractConclusion(failure, 1, 'code');

    // Assert
    expect(conclusion.note).toBe(expected);
  });

  it('should fall back to buildFeedbackMessage when summarize returns null', async () => {
    // Arrange
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');
    const summarize = async (_f: GateFailure): Promise<string | null> => null;
    const expected = buildFeedbackMessage(failure);

    // Act
    const conclusion = await extractConclusion(failure, 2, 'test', summarize);

    // Assert
    expect(conclusion.note).toBe(expected);
  });

  it('should fall back to buildFeedbackMessage when summarize returns an empty string', async () => {
    // Arrange
    const failure = makeFailure('tsc', 'error TS2345');
    const summarize = async (): Promise<string | null> => '';
    const expected = buildFeedbackMessage(failure);

    // Act
    const conclusion = await extractConclusion(failure, 1, 'code', summarize);

    // Assert
    expect(conclusion.note).toBe(expected);
  });

  it('should fall back to buildFeedbackMessage when summarize throws', async () => {
    // Arrange
    const failure = makeFailure('test', 'FAIL src/foo.test.ts\nExpected true');
    const summarize = async (): Promise<string | null> => {
      throw new Error('network timeout');
    };
    const expected = buildFeedbackMessage(failure);

    // Act
    const conclusion = await extractConclusion(failure, 3, 'test', summarize);

    // Assert
    expect(conclusion.note).toBe(expected);
  });

  it('should set attempt and stage from the inputs', async () => {
    // Arrange
    const failure = makeFailure('tsc', 'error TS2345');

    // Act
    const conclusion = await extractConclusion(failure, 4, 'test');

    // Assert
    expect(conclusion.attempt).toBe(4);
    expect(conclusion.stage).toBe('test');
  });

  it('should set signature via failureSignature', async () => {
    // Arrange
    const failure = makeFailure('tsc', 'error TS2345');
    const expected = failureSignature(failure);

    // Act
    const conclusion = await extractConclusion(failure, 1, 'code');

    // Assert
    expect(conclusion.signature).toBe(expected);
  });

  it('should thread the file context into the fallback note', async () => {
    // Arrange
    const failure = makeFailure('tsc', 'error TS2345: type mismatch');
    const expected = buildFeedbackMessage(failure, 'slice');

    // Act
    const conclusion = await extractConclusion(failure, 1, 'code', undefined, 'slice');

    // Assert
    expect(conclusion.note).toBe(expected);
  });
});
