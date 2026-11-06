import { describe, expect, it } from 'vitest';

import { shouldShowModelBadge } from './shouldShowModelBadge';

describe('shouldShowModelBadge', () => {
  // FR-041: first assistant message always shows badge
  it('should return true when isFirstAssistantMessage is true regardless of model values', () => {
    // Given: first assistant message with matching models
    // When
    const result = shouldShowModelBadge('gpt-4', 'gpt-4', true);
    // Then
    expect(result).toBe(true);
  });

  // FR-040: model differs from previous assistant → show badge
  it('should return true when model differs from previousAssistantModel and is not the first message', () => {
    // Given: second+ message, different model from previous
    // When
    const result = shouldShowModelBadge('gpt-4', 'claude-3', false);
    // Then
    expect(result).toBe(true);
  });

  // FR-042: same model as previous → no badge
  it('should return false when model matches previousAssistantModel and is not the first message', () => {
    // Given: second+ message, same model as previous
    // When
    const result = shouldShowModelBadge('gpt-4', 'gpt-4', false);
    // Then
    expect(result).toBe(false);
  });

  // No model info → no badge regardless of other args
  it('should return false when currentModel is undefined regardless of other arguments', () => {
    // Given: no model info on the message
    // When
    const result = shouldShowModelBadge(undefined, undefined, true);
    // Then
    expect(result).toBe(false);
  });

  // Previous undefined, not first → treat as new model appearance → show badge
  it('should return true when previousAssistantModel is undefined and currentModel is set and is not the first message', () => {
    // Given: has model, no previous to compare
    // When
    const result = shouldShowModelBadge('gpt-4', undefined, false);
    // Then
    expect(result).toBe(true);
  });
});
