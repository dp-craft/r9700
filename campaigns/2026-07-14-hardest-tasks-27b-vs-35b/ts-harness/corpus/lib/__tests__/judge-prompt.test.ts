import { describe, expect, it } from 'vitest';

import type { ComparisonRequest, JudgeRequest } from '@/lib/judge-prompt';
import {
  buildEvalComparisonPrompt,
  buildJudgePrompt,
  COMPARISON_SYSTEM_PROMPT,
  JUDGE_RUBRIC_SYSTEM
} from '@/lib/judge-prompt';

// -- Builders --

const createJudgeRequest = (overrides: Partial<JudgeRequest> = {}): JudgeRequest => ({
  userPrompt: 'What is the capital of France?',
  responseText: 'The capital of France is Paris.',
  systemPrompt: 'You are a helpful geography assistant.',
  ...overrides,
});

const createComparisonRequest = (
  overrides: Partial<ComparisonRequest> = {}
): ComparisonRequest => ({
  comparisonInstruction: 'Compare these outputs and rank them.',
  userPrompt: 'Summarise the plot of Hamlet.',
  systemPrompt: 'You are a concise literary assistant.',
  outputs: [
    { id: 'cell-1', label: 'Output 1', text: 'Hamlet avenges his father.' },
    { id: 'cell-2', label: 'Output 2', text: 'A prince seeks revenge in Denmark.' },
  ],
  ...overrides,
});

// ===========================================================================
// JUDGE_RUBRIC_SYSTEM constant
// ===========================================================================

describe('JUDGE_RUBRIC_SYSTEM', () => {
  it('should contain the 1-4 scoring scale', () => {
    expect(JUDGE_RUBRIC_SYSTEM).toContain('1');
    expect(JUDGE_RUBRIC_SYSTEM).toContain('2');
    expect(JUDGE_RUBRIC_SYSTEM).toContain('3');
    expect(JUDGE_RUBRIC_SYSTEM).toContain('4');
  });

  it('should contain all 5 criteria names', () => {
    const criteriaNames = ['relevance', 'coherence', 'completeness', 'helpfulness', 'conciseness'];

    criteriaNames.forEach(name => {
      expect(JUDGE_RUBRIC_SYSTEM.toLowerCase()).toContain(name);
    });
  });

  it('should request JSON output format', () => {
    expect(JUDGE_RUBRIC_SYSTEM.toLowerCase()).toContain('json');
  });
});

// ===========================================================================
// buildJudgePrompt
// ===========================================================================

describe('buildJudgePrompt', () => {
  // -- Positive paths --

  it('should include user prompt in userMessage', () => {
    const request = createJudgeRequest({ userPrompt: 'Explain quantum computing' });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toContain('Explain quantum computing');
  });

  it('should include response text in userMessage', () => {
    const request = createJudgeRequest({ responseText: 'Quantum computing uses qubits.' });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toContain('Quantum computing uses qubits.');
  });

  it('should include system prompt context when provided', () => {
    const request = createJudgeRequest({ systemPrompt: 'You are a physics teacher.' });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toContain('You are a physics teacher.');
  });

  it('should omit system prompt section when systemPrompt is null', () => {
    const requestWithSystem = createJudgeRequest({ systemPrompt: 'You are a helper.' });
    const requestWithoutSystem = createJudgeRequest({ systemPrompt: null });

    const resultWithSystem = buildJudgePrompt(requestWithSystem);
    const resultWithoutSystem = buildJudgePrompt(requestWithoutSystem);

    expect(resultWithSystem.userMessage).toContain('You are a helper.');
    expect(resultWithoutSystem.userMessage).not.toContain('You are a helper.');
    expect(resultWithoutSystem.userMessage.length).toBeLessThan(
      resultWithSystem.userMessage.length
    );
  });

  it('should return systemMessage matching the rubric constant', () => {
    const request = createJudgeRequest();

    const result = buildJudgePrompt(request);

    expect(result.systemMessage).toBe(JUDGE_RUBRIC_SYSTEM);
  });

  // -- Edge cases --

  it('should handle empty user prompt', () => {
    const request = createJudgeRequest({ userPrompt: '' });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toBeDefined();
    expect(result.systemMessage).toBe(JUDGE_RUBRIC_SYSTEM);
  });

  it('should handle empty response text', () => {
    const request = createJudgeRequest({ responseText: '' });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toBeDefined();
    expect(result.systemMessage).toBe(JUDGE_RUBRIC_SYSTEM);
  });

  it('should handle special characters in prompts', () => {
    const request = createJudgeRequest({
      userPrompt: 'What is "hello" in <French>?',
      responseText: 'It\'s "bonjour" — a common greeting.',
    });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toContain('What is "hello" in <French>?');
    expect(result.userMessage).toContain('It\'s "bonjour"');
  });

  it('should handle very long response text without truncation', () => {
    const longText = 'word '.repeat(5000);
    const request = createJudgeRequest({ responseText: longText });

    const result = buildJudgePrompt(request);

    expect(result.userMessage).toContain(longText);
  });
});

// ===========================================================================
// COMPARISON_SYSTEM_PROMPT constant
// ===========================================================================

describe('COMPARISON_SYSTEM_PROMPT', () => {
  it('should request JSON output format', () => {
    expect(COMPARISON_SYSTEM_PROMPT.toLowerCase()).toContain('json');
  });

  it('should mention cellId in the JSON schema so the model attributes ranks', () => {
    expect(COMPARISON_SYSTEM_PROMPT).toContain('cellId');
  });
});

// ===========================================================================
// buildEvalComparisonPrompt
// ===========================================================================

describe('buildEvalComparisonPrompt', () => {
  it('should include the comparison instruction in the userMessage', () => {
    const request = createComparisonRequest({
      comparisonInstruction: 'Rank by faithfulness to the source.',
    });

    const result = buildEvalComparisonPrompt(request);

    expect(result.userMessage).toContain('Rank by faithfulness to the source.');
  });

  it('should include the original user prompt in the userMessage', () => {
    const request = createComparisonRequest({ userPrompt: 'Explain monads simply.' });

    const result = buildEvalComparisonPrompt(request);

    expect(result.userMessage).toContain('Explain monads simply.');
  });

  it('should include the system prompt when provided', () => {
    const request = createComparisonRequest({ systemPrompt: 'You are terse.' });

    const result = buildEvalComparisonPrompt(request);

    expect(result.userMessage).toContain('You are terse.');
  });

  it('should omit the system prompt section when systemPrompt is null', () => {
    const request = createComparisonRequest({ systemPrompt: null });

    const result = buildEvalComparisonPrompt(request);

    expect(result.userMessage).not.toContain('[System Prompt Context]');
  });

  it('should include every output label and text', () => {
    const request = createComparisonRequest();

    const result = buildEvalComparisonPrompt(request);

    expect(result.userMessage).toContain('Output 1');
    expect(result.userMessage).toContain('Hamlet avenges his father.');
    expect(result.userMessage).toContain('Output 2');
    expect(result.userMessage).toContain('A prince seeks revenge in Denmark.');
  });

  it('should return systemMessage matching the comparison system constant', () => {
    const request = createComparisonRequest();

    const result = buildEvalComparisonPrompt(request);

    expect(result.systemMessage).toBe(COMPARISON_SYSTEM_PROMPT);
  });
});
