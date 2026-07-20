import { describe, expect, it } from 'vitest';

import { MF_REGISTRY } from '../constants';

describe('MF_REGISTRY', () => {
  it('should have exactly keys chat and prompt-lab', () => {
    // Given: the registry is imported
    // When: keys are inspected
    const keys = Object.keys(MF_REGISTRY).sort();
    // Then: only the two workspace keys exist — no run-history, prompt-history, or skills
    expect(keys).toEqual(['chat', 'prompt-lab']);
  });

  it('should not contain run-history as a key', () => {
    expect('run-history' in MF_REGISTRY).toBe(false);
  });

  it('should not contain prompt-history as a key', () => {
    expect('prompt-history' in MF_REGISTRY).toBe(false);
  });

  it('should not contain skills as a key', () => {
    expect('skills' in MF_REGISTRY).toBe(false);
  });
});
