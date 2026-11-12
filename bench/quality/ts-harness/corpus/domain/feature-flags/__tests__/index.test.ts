import { describe, expect, it } from 'vitest';

import { FEATURE_FLAG_REGISTRY } from '../index';

describe('FEATURE_FLAG_REGISTRY', () => {
  describe('\'tutorial-enabled\' entry', () => {
    it('should have defaultValue strictly false (FR-082)', () => {
      // Given the registry is imported
      // When accessing the tutorial-enabled entry
      // Then defaultValue is false (disabled by default per FR-082)
      expect(FEATURE_FLAG_REGISTRY['tutorial-enabled'].defaultValue).toBe(false);
    });

    it('should contain the tutorial-enabled key (re-enable path preserved)', () => {
      // Given the registry
      // When checking for key presence
      // Then the key exists (module not deleted, future re-enable is possible)
      expect('tutorial-enabled' in FEATURE_FLAG_REGISTRY).toBe(true);
    });

    it('should have key field equal to the registry key (self-consistent entry)', () => {
      // Given the registry
      // When reading the key field of the tutorial-enabled entry
      // Then it matches the registry key
      expect(FEATURE_FLAG_REGISTRY['tutorial-enabled'].key).toBe('tutorial-enabled');
    });
  });
});
