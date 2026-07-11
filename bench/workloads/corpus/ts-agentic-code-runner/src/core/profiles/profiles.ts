import type { BackendKind, RungName } from '../shared';

export interface ModelProfile {
  readonly name: string;
  readonly backend: BackendKind;
  readonly modelId: string;
  readonly baseUrl?: string; // required for 'openai-compatible' (vllm/unsloth) and ollama overrides
}

export const DEFAULT_PROFILE_NAME = 'local-default';
export const OPENROUTER_PROFILE_NAME = 'openrouter-default';

const DEFAULT_MODEL_ID = 'qwen2.5-coder:7b';
const LARGE_LOCAL_MODEL_ID = 'Qwen3-Coder-30B-A3B';
const FALLBACK_MODEL_ID = 'Devstral-24B';

export const ENV_MODEL_ID_KEY = 'RUNNER_MODEL_ID';
export const ENV_BASE_URL_KEY = 'RUNNER_BASE_URL';
export const ENV_RULES_PATH_KEY = 'RUNNER_RULES_PATH';
export const ENV_PROFILE_KEY = 'RUNNER_PROFILE';
const OPENROUTER_MODEL_ID = 'qwen/qwen3.6-35b-a3b';

const VLLM_BASE_URL = 'http://127.0.0.1:8000/v1';
const UNSLOTH_BASE_URL = 'http://127.0.0.1:8001/v1';

export const BUILTIN_PROFILES: Readonly<Record<string, ModelProfile>> = {
  [DEFAULT_PROFILE_NAME]: {
    name: DEFAULT_PROFILE_NAME,
    backend: 'ollama',
    modelId: DEFAULT_MODEL_ID,
  },
  'local-fallback': {
    name: 'local-fallback',
    backend: 'ollama',
    modelId: FALLBACK_MODEL_ID,
  },
  [OPENROUTER_PROFILE_NAME]: {
    name: OPENROUTER_PROFILE_NAME,
    backend: 'openrouter',
    modelId: OPENROUTER_MODEL_ID,
  },
  'vllm-qwen-coder': {
    name: 'vllm-qwen-coder',
    backend: 'openai-compatible',
    modelId: LARGE_LOCAL_MODEL_ID,
    baseUrl: VLLM_BASE_URL,
  },
  'unsloth-devstral': {
    name: 'unsloth-devstral',
    backend: 'openai-compatible',
    modelId: FALLBACK_MODEL_ID,
    baseUrl: UNSLOTH_BASE_URL,
  },
};

function envOverride(key: string): string | undefined {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : undefined;
}

function applyEnvOverrides(profile: ModelProfile): ModelProfile {
  const modelId = envOverride(ENV_MODEL_ID_KEY);
  const baseUrl = envOverride(ENV_BASE_URL_KEY);
  if (modelId === undefined && baseUrl === undefined) {
    return profile;
  }
  return {
    ...profile,
    modelId: modelId ?? profile.modelId,
    baseUrl: baseUrl ?? profile.baseUrl,
  };
}

export function resolveProfile(name?: string): ModelProfile {
  const key = name ?? envOverride(ENV_PROFILE_KEY) ?? DEFAULT_PROFILE_NAME;
  const profile = BUILTIN_PROFILES[key];
  if (profile === undefined) {
    throw new Error(`Unknown model profile: '${key}'`);
  }
  return applyEnvOverrides(profile);
}

// Maps an escalation rung to the profile that should drive that rung's generation.
// 'claude' terminates before generating, so it falls through to the base profile (unused).
export function profileForRung(rung: RungName, baseProfile: ModelProfile): ModelProfile {
  if (rung === 'openrouter') {
    return applyEnvOverrides(BUILTIN_PROFILES[OPENROUTER_PROFILE_NAME]);
  }
  return applyEnvOverrides(baseProfile);
}
