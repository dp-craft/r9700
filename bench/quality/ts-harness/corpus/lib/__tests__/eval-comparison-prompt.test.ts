import { describe, expect, it } from 'vitest';

import type {
  EvalComparisonCandidate,
  EvalComparisonPromptRequest
} from '@/lib/eval-comparison-prompt';
import { buildEvalComparisonPrompt } from '@/lib/eval-comparison-prompt';

// -- Builders --

const createCandidate = (overrides: Partial<EvalComparisonCandidate> = {}): EvalComparisonCandidate => ({
  cellId: 'default-cell',
  output: 'Default output',
  ...overrides,
});

const createRequest = (overrides: Partial<EvalComparisonPromptRequest> = {}): EvalComparisonPromptRequest => ({
  userPrompt: 'Write a haiku about the moon.',
  systemPrompts: ['You are a poetry assistant. Be creative.'],
  candidates: [
    createCandidate({ cellId: 'cell-1', output: 'White moon shines bright\nIn the dark night sky\nPeaceful, calm, serene' }),
    createCandidate({ cellId: 'cell-2', output: 'The moon glows softly\nCasting shadows on the ground\nNight is quiet now' }),
  ],
  ...overrides,
});

// ===========================================================================
// 1. One labelled block per candidate, sequential labels (A, B, C…)
// ===========================================================================

describe('labelled output blocks', () => {
  it('should produce one labelled block per candidate with sequential labels A, B, C', () => {
    const req = createRequest({
      candidates: [
        createCandidate({ cellId: 'a', output: 'first' }),
        createCandidate({ cellId: 'b', output: 'second' }),
        createCandidate({ cellId: 'c', output: 'third' }),
      ],
    });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).toContain('### Output A');
    expect(result.userMessage).toContain('first');
    expect(result.userMessage).toContain('### Output B');
    expect(result.userMessage).toContain('second');
    expect(result.userMessage).toContain('### Output C');
    expect(result.userMessage).toContain('third');
  });

  it('should handle two candidates with labels A and B', () => {
    const req = createRequest({
      candidates: [
        createCandidate({ cellId: 'x', output: 'alpha' }),
        createCandidate({ cellId: 'y', output: 'beta' }),
      ],
    });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).toContain('### Output A');
    expect(result.userMessage).toContain('alpha');
    expect(result.userMessage).toContain('### Output B');
    expect(result.userMessage).toContain('beta');
    expect(result.userMessage).not.toContain('### Output C');
  });
});

// ===========================================================================
// 2. labelMap maps each label to its cellId
// ===========================================================================

describe('labelMap', () => {
  it('should map each label to its corresponding candidate cellId', () => {
    const req = createRequest({
      candidates: [
        createCandidate({ cellId: 'cell-alpha' }),
        createCandidate({ cellId: 'cell-beta' }),
        createCandidate({ cellId: 'cell-gamma' }),
      ],
    });

    const result = buildEvalComparisonPrompt(req);

    expect(result.labelMap).toHaveLength(3);
    expect(result.labelMap[0]).toEqual({ label: 'Output A', cellId: 'cell-alpha' });
    expect(result.labelMap[1]).toEqual({ label: 'Output B', cellId: 'cell-beta' });
    expect(result.labelMap[2]).toEqual({ label: 'Output C', cellId: 'cell-gamma' });
  });

  it('should map one candidate to a single label-entry in labelMap', () => {
    const req = createRequest({
      candidates: [createCandidate({ cellId: 'solo' })],
    });

    const result = buildEvalComparisonPrompt(req);

    expect(result.labelMap).toHaveLength(1);
    expect(result.labelMap[0]).toEqual({ label: 'Output A', cellId: 'solo' });
  });
});

// ===========================================================================
// 3. Original userPrompt + each system prompt present in userMessage
// ===========================================================================

describe('userMessage composition', () => {
  it('should include the original userPrompt in the userMessage', () => {
    const userPrompt = 'Write a haiku about the moon.';
    const req = createRequest({ userPrompt });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).toContain(userPrompt);
  });

  it('should include all system prompts in the userMessage', () => {
    const sys1 = 'You are a poetry assistant.';
    const sys2 = 'Be creative and use vivid imagery.';
    const req = createRequest({ systemPrompts: [sys1, sys2] });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).toContain(sys1);
    expect(result.userMessage).toContain(sys2);
  });

  it('should include candidate outputs in the userMessage', () => {
    const output = 'White moon shines bright';
    const req = createRequest({
      candidates: [createCandidate({ cellId: 'x', output })],
    });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).toContain(output);
  });
});

// ===========================================================================
// 4. Zero system prompts → no system-prompt section, no crash
// ===========================================================================

describe('zero system prompts', () => {
  it('should compose without a system-prompt section when systemPrompts is empty', () => {
    const req = createRequest({ systemPrompts: [] });

    const result = buildEvalComparisonPrompt(req);

    expect(result.userMessage).not.toContain('[System Prompt]');
    expect(result.userMessage).toContain(req.userPrompt);
    expect(result.userMessage).toContain('### Output A');
  });

  it('should not crash with zero system prompts', () => {
    const req = createRequest({ systemPrompts: [] });

    expect(() => buildEvalComparisonPrompt(req)).not.toThrow();
  });
});

// ===========================================================================
// 5. systemMessage requests ranking + single winner + per-criterion reasoning
// ===========================================================================

describe('EVAL_COMPARISON_SYSTEM content', () => {
  it('systemMessage should request ranking of all outputs', () => {
    const req = createRequest();
    const result = buildEvalComparisonPrompt(req);

    expect(result.systemMessage).toContain('rank');
    expect(result.systemMessage).toContain('winner');
  });

  it('systemMessage should request per-criterion reasoning before verdict', () => {
    const req = createRequest();
    const result = buildEvalComparisonPrompt(req);

    expect(result.systemMessage).toContain('reasoning');
    expect(result.systemMessage).toContain('criterion');
    expect(result.systemMessage).toContain('verdict');
  });

  it('should include an evaluation rubric in the system message', () => {
    const req = createRequest();
    const result = buildEvalComparisonPrompt(req);

    expect(result.systemMessage).toContain('Relevance');
    expect(result.systemMessage).toContain('Completeness');
    expect(result.systemMessage).toContain('Quality');
  });
});

// ===========================================================================
// 6. Output deterministic for fixed input (pure)
// ===========================================================================

describe('determinism', () => {
  it('should return identical results for the same input on repeated calls', () => {
    const req = createRequest();

    const first = buildEvalComparisonPrompt(req);
    const second = buildEvalComparisonPrompt(req);

    expect(first).toEqual(second);
    expect(first.systemMessage).toBe(second.systemMessage);
    expect(first.userMessage).toBe(second.userMessage);
    expect(first.labelMap).toEqual(second.labelMap);
  });

  it('should produce stable labels regardless of cellId values', () => {
    const reqA = createRequest({
      candidates: [
        createCandidate({ cellId: 'id-999', output: 'test' }),
      ],
    });
    const reqB = createRequest({
      candidates: [
        createCandidate({ cellId: 'id-000', output: 'test' }),
      ],
    });

    const resultA = buildEvalComparisonPrompt(reqA);
    const resultB = buildEvalComparisonPrompt(reqB);

    expect(resultA.labelMap[0].label).toBe('Output A');
    expect(resultB.labelMap[0].label).toBe('Output A');
  });
});
