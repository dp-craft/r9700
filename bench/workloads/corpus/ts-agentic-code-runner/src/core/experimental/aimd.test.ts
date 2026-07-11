import { describe, expect, it } from 'vitest';

import { adjust, type AimdConfig, type AimdState, DEFAULT_AIMD_CONFIG } from './aimd';

const disabledCfg: AimdConfig = DEFAULT_AIMD_CONFIG;
const enabledCfg: AimdConfig = { enabled: true };

describe('DEFAULT_AIMD_CONFIG', () => {
  it('should default to disabled', () => {
    expect(DEFAULT_AIMD_CONFIG.enabled).toBe(false);
  });
});

describe('adjust', () => {
  it('should return the input state unchanged on success when disabled', () => {
    const state: AimdState = { value: 4 };

    expect(adjust(state, disabledCfg, 'success')).toBe(state);
  });

  it('should return the input state unchanged on failure when disabled', () => {
    const state: AimdState = { value: 4 };

    expect(adjust(state, disabledCfg, 'failure')).toBe(state);
  });

  it('should additively increase the value on success when enabled', () => {
    const state: AimdState = { value: 4 };

    expect(adjust(state, enabledCfg, 'success')).toEqual({ value: 5 });
  });

  it('should multiplicatively decrease the value on failure when enabled', () => {
    const state: AimdState = { value: 4 };

    expect(adjust(state, enabledCfg, 'failure')).toEqual({ value: 2 });
  });
});
