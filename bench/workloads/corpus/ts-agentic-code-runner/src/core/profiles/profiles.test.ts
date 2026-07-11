import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_PROFILES,
  DEFAULT_PROFILE_NAME,
  ENV_PROFILE_KEY,
  OPENROUTER_PROFILE_NAME,
  profileForRung,
  resolveProfile
} from './profiles';

const ENV_MODEL_ID = 'RUNNER_MODEL_ID';
const ENV_BASE_URL = 'RUNNER_BASE_URL';

describe('resolveProfile', () => {
  let savedModelId: string | undefined;
  let savedBaseUrl: string | undefined;
  let savedProfile: string | undefined;

  beforeEach(() => {
    savedModelId = process.env[ENV_MODEL_ID];
    savedBaseUrl = process.env[ENV_BASE_URL];
    savedProfile = process.env[ENV_PROFILE_KEY];
    delete process.env[ENV_MODEL_ID];
    delete process.env[ENV_BASE_URL];
    delete process.env[ENV_PROFILE_KEY];
  });

  afterEach(() => {
    restoreEnv(ENV_MODEL_ID, savedModelId);
    restoreEnv(ENV_BASE_URL, savedBaseUrl);
    restoreEnv(ENV_PROFILE_KEY, savedProfile);
  });

  it('should resolve the local-default profile mapping to qwen2.5-coder:7b when name is unspecified', () => {
    const profile = resolveProfile();

    expect(profile.name).toBe(DEFAULT_PROFILE_NAME);
    expect(profile.backend).toBe('ollama');
    expect(profile.modelId).toBe('qwen2.5-coder:7b');
  });

  it('should resolve the Devstral fallback profile to Devstral-24B when its name is given', () => {
    const profile = resolveProfile('local-fallback');

    expect(profile.backend).toBe('ollama');
    expect(profile.modelId).toBe('Devstral-24B');
  });

  it('should resolve a known name to its mapped model id', () => {
    const profile = resolveProfile(DEFAULT_PROFILE_NAME);

    expect(profile.modelId).toBe('qwen2.5-coder:7b');
  });

  it('should throw a typed error when the profile name is unknown', () => {
    expect(() => resolveProfile('does-not-exist')).toThrow(/unknown.*profile/i);
  });

  it('should resolve a vllm- profile to openai-compatible backend with a baseUrl', () => {
    const name = Object.keys(BUILTIN_PROFILES).find(key => key.startsWith('vllm-'));
    expect(name).toBeDefined();

    const profile = resolveProfile(name);

    expect(profile.backend).toBe('openai-compatible');
    expect(profile.baseUrl).toBeTruthy();
  });

  it('should resolve an unsloth- profile to openai-compatible backend with a baseUrl', () => {
    const name = Object.keys(BUILTIN_PROFILES).find(key => key.startsWith('unsloth-'));
    expect(name).toBeDefined();

    const profile = resolveProfile(name);

    expect(profile.backend).toBe('openai-compatible');
    expect(profile.baseUrl).toBeTruthy();
  });

  it('should override the resolved modelId when RUNNER_MODEL_ID is set', () => {
    process.env[ENV_MODEL_ID] = 'custom-model:latest';

    const profile = resolveProfile();

    expect(profile.modelId).toBe('custom-model:latest');
  });

  it('should override the resolved baseUrl when RUNNER_BASE_URL is set', () => {
    process.env[ENV_BASE_URL] = 'http://127.0.0.1:9999/v1';

    const profile = resolveProfile();

    expect(profile.baseUrl).toBe('http://127.0.0.1:9999/v1');
  });

  it('should leave named-profile values unchanged when no env overrides are set', () => {
    const profile = resolveProfile('local-fallback');

    expect(profile.modelId).toBe('Devstral-24B');
    expect(profile.baseUrl).toBeUndefined();
  });

  it('should ignore an empty RUNNER_MODEL_ID and keep the named-profile model id', () => {
    process.env[ENV_MODEL_ID] = '';

    const profile = resolveProfile('local-fallback');

    expect(profile.modelId).toBe('Devstral-24B');
  });

  it('should return the openrouter profile when RUNNER_PROFILE=openrouter-default and no name arg', () => {
    process.env[ENV_PROFILE_KEY] = 'openrouter-default';

    const profile = resolveProfile();

    expect(profile.backend).toBe('openrouter');
    expect(profile.name).toBe(OPENROUTER_PROFILE_NAME);
  });

  it('should let an explicit name arg win over RUNNER_PROFILE env var', () => {
    process.env[ENV_PROFILE_KEY] = 'openrouter-default';

    const profile = resolveProfile('local-default');

    expect(profile.backend).toBe('ollama');
    expect(profile.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it('should return local-default when RUNNER_PROFILE is unset and no name arg', () => {
    const profile = resolveProfile();

    expect(profile.name).toBe(DEFAULT_PROFILE_NAME);
  });

  it('should throw Unknown model profile when RUNNER_PROFILE is bogus and no name arg', () => {
    process.env[ENV_PROFILE_KEY] = 'bogus-profile';

    expect(() => resolveProfile()).toThrow(/unknown.*profile/i);
  });
});

// T022: re-verifies the rung→profile mapping stays correct after T008 changed the default
// modelId. The openrouter rung must still resolve to the built-in openrouter profile;
// other rungs (ollama, claude) must return the caller-supplied baseProfile unchanged.
describe('profileForRung', () => {
  it('should return the built-in openrouter profile when rung is openrouter', () => {
    // Given
    const baseProfile = resolveProfile(DEFAULT_PROFILE_NAME);
    const expected = BUILTIN_PROFILES[OPENROUTER_PROFILE_NAME];

    // When
    const result = profileForRung('openrouter', baseProfile);

    // Then
    expect(result.backend).toBe('openrouter');
    expect(result.modelId).toBe('qwen/qwen3.6-35b-a3b');
    expect(result).toBe(expected);
  });

  it('should ignore the baseProfile and return the openrouter profile when rung is openrouter', () => {
    // Given — pass a non-default base to prove openrouter rung does not pass it through
    const ollamaBase = resolveProfile(DEFAULT_PROFILE_NAME);

    // When
    const result = profileForRung('openrouter', ollamaBase);

    // Then — result must be the openrouter profile, NOT the ollama base
    expect(result).not.toBe(ollamaBase);
    expect(result.backend).toBe('openrouter');
    expect(result).toBe(BUILTIN_PROFILES[OPENROUTER_PROFILE_NAME]);
  });

  it('should return the baseProfile unchanged (referential identity) when rung is ollama', () => {
    // Given
    const baseProfile = resolveProfile(DEFAULT_PROFILE_NAME);

    // When
    const result = profileForRung('ollama', baseProfile);

    // Then
    expect(result).toBe(baseProfile);
  });

  it('should return the baseProfile unchanged (referential identity) when rung is claude', () => {
    // Given
    const baseProfile = resolveProfile(DEFAULT_PROFILE_NAME);

    // When
    const result = profileForRung('claude', baseProfile);

    // Then
    expect(result).toBe(baseProfile);
  });

  it('should apply RUNNER_MODEL_ID over the built-in openrouter model id when rung is openrouter', () => {
    // Given
    const baseProfile = resolveProfile(DEFAULT_PROFILE_NAME);
    const saved = process.env[ENV_MODEL_ID];
    try {
      process.env[ENV_MODEL_ID] = 'qwen/qwen3-coder';

      // When
      const result = profileForRung('openrouter', baseProfile);

      // Then — explicit pin wins, NOT the hardcoded claude id
      expect(result.modelId).toBe('qwen/qwen3-coder');
      expect(result.modelId).not.toBe('qwen/qwen3.6-35b-a3b');
      expect(result.backend).toBe('openrouter');
    } finally {
      restoreEnv(ENV_MODEL_ID, saved);
    }
  });

  it('should keep the built-in openrouter model id when no RUNNER_MODEL_ID override is set', () => {
    // Given
    const baseProfile = resolveProfile(DEFAULT_PROFILE_NAME);
    const saved = process.env[ENV_MODEL_ID];
    try {
      delete process.env[ENV_MODEL_ID];

      // When
      const result = profileForRung('openrouter', baseProfile);

      // Then
      expect(result.modelId).toBe('qwen/qwen3.6-35b-a3b');
    } finally {
      restoreEnv(ENV_MODEL_ID, saved);
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
