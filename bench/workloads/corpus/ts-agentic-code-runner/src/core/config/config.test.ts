import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENV } from '../shared/envKeys';
import { applyProfileByName, applyRoleProfile, loadRunnerConfig, RunnerConfigSchema } from './config';

const RUNNER_ENV_KEYS = Object.values(ENV);

describe('loadRunnerConfig', () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined>;

  const writeConfig = (value: unknown): string => {
    const path = join(dir, 'runner.config.json');
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-config-'));
    savedEnv = Object.fromEntries(RUNNER_ENV_KEYS.map(k => [k, process.env[k]]));
    RUNNER_ENV_KEYS.forEach(k => delete process.env[k]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    RUNNER_ENV_KEYS.forEach(k => {
      const prior = savedEnv[k];
      if (prior === undefined) delete process.env[k];
      else process.env[k] = prior;
    });
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should set all RUNNER_* env vars when given a valid full config', () => {
    const path = writeConfig({
      delegation: 'runner',
      provider: 'openrouter',
      profile: 'openrouter-default',
      modelId: 'openai/gpt-oss-120b:free',
      generateTimeoutMs: 90000,
      openrouter: { allowFallbacks: true, provider: 'novita', quantization: 'fp8' },
    });

    loadRunnerConfig(path);

    expect(process.env.RUNNER_DELEGATION).toBe('runner');
    expect(process.env.RUNNER_PROVIDER).toBe('openrouter');
    expect(process.env.RUNNER_PROFILE).toBe('openrouter-default');
    expect(process.env.RUNNER_MODEL_ID).toBe('openai/gpt-oss-120b:free');
    expect(process.env.RUNNER_GENERATE_TIMEOUT_MS).toBe('90000');
    expect(process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS).toBe('true');
    expect(process.env.RUNNER_OPENROUTER_PROVIDER).toBe('novita');
    expect(process.env.RUNNER_OPENROUTER_QUANTIZATION).toBe('fp8');
  });

  it('should authoritatively overwrite a pre-set stale env value', () => {
    process.env.RUNNER_MODEL_ID = 'stale/model';
    const path = writeConfig({ delegation: 'runner', modelId: 'openai/gpt-oss-120b:free' });

    loadRunnerConfig(path);

    expect(process.env.RUNNER_MODEL_ID).toBe('openai/gpt-oss-120b:free');
  });

  it('should no-op when the config file is missing', () => {
    loadRunnerConfig(join(dir, 'does-not-exist.json'));

    RUNNER_ENV_KEYS.forEach(k => expect(process.env[k]).toBeUndefined());
  });

  it('should apply nothing and log an error when a field has the wrong type', () => {
    const path = writeConfig({ delegation: 'runner', generateTimeoutMs: -1 });

    loadRunnerConfig(path);

    RUNNER_ENV_KEYS.forEach(k => expect(process.env[k]).toBeUndefined());
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[runner] invalid runner.config.json:')
    );
  });

  it('should reject unknown keys via strict and apply nothing', () => {
    const path = writeConfig({ delegation: 'runner', bogus: 'x' });

    loadRunnerConfig(path);

    RUNNER_ENV_KEYS.forEach(k => expect(process.env[k]).toBeUndefined());
    expect(console.error).toHaveBeenCalled();
  });

  it('should set only RUNNER_DELEGATION when only delegation is present', () => {
    const path = writeConfig({ delegation: 'claude' });

    loadRunnerConfig(path);

    expect(process.env.RUNNER_DELEGATION).toBe('claude');
    expect(process.env.RUNNER_PROVIDER).toBeUndefined();
    expect(process.env.RUNNER_MODEL_ID).toBeUndefined();
    expect(process.env.RUNNER_OPENROUTER_ALLOW_FALLBACKS).toBeUndefined();
  });

  it('should set every ollama and openrouter sampling knob when given a full config', () => {
    const path = writeConfig({
      delegation: 'runner',
      provider: 'ollama',
      maxSteps: 40,
      maxToolOutputChars: 64000,
      largeFileLines: 800,
      ollama: {
        numCtx: 65536,
        temperature: 0.2,
        topP: 0.9,
        topK: 40,
        repeatPenalty: 1.1,
        numPredict: 4096,
        idleTimeoutMs: 300000,
        think: true,
      },
      openrouter: {
        allowFallbacks: false,
        temperature: 0.3,
        topP: 0.95,
        topK: 50,
        minP: 0.05,
        repetitionPenalty: 1.05,
        reasoningEffort: 'high',
        reasoningMaxTokens: 8000,
        cacheControl: 'ephemeral',
      },
    });

    loadRunnerConfig(path);

    expect(process.env[ENV.MAX_STEPS]).toBe('40');
    expect(process.env[ENV.MAX_TOOL_OUTPUT_CHARS]).toBe('64000');
    expect(process.env[ENV.LARGE_FILE_LINES]).toBe('800');
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBe('65536');
    expect(process.env[ENV.OLLAMA_TEMPERATURE]).toBe('0.2');
    expect(process.env[ENV.OLLAMA_TOP_P]).toBe('0.9');
    expect(process.env[ENV.OLLAMA_TOP_K]).toBe('40');
    expect(process.env[ENV.OLLAMA_REPEAT_PENALTY]).toBe('1.1');
    expect(process.env[ENV.OLLAMA_NUM_PREDICT]).toBe('4096');
    expect(process.env[ENV.OLLAMA_IDLE_TIMEOUT_MS]).toBe('300000');
    expect(process.env[ENV.OLLAMA_THINK]).toBe('true');
    expect(process.env[ENV.OPENROUTER_TEMPERATURE]).toBe('0.3');
    expect(process.env[ENV.OPENROUTER_TOP_P]).toBe('0.95');
    expect(process.env[ENV.OPENROUTER_TOP_K]).toBe('50');
    expect(process.env[ENV.OPENROUTER_MIN_P]).toBe('0.05');
    expect(process.env[ENV.OPENROUTER_REPETITION_PENALTY]).toBe('1.05');
    expect(process.env[ENV.OPENROUTER_REASONING_EFFORT]).toBe('high');
    expect(process.env[ENV.OPENROUTER_REASONING_MAX_TOKENS]).toBe('8000');
    expect(process.env[ENV.OPENROUTER_CACHE_CONTROL]).toBe('ephemeral');
  });

  it('should stringify think false to the literal "false"', () => {
    const path = writeConfig({ delegation: 'runner', ollama: { think: false } });

    loadRunnerConfig(path);

    expect(process.env[ENV.OLLAMA_THINK]).toBe('false');
  });

  it('should not set ollama env vars when the ollama block is absent', () => {
    const path = writeConfig({ delegation: 'runner', maxSteps: 10 });

    loadRunnerConfig(path);

    expect(process.env[ENV.MAX_STEPS]).toBe('10');
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBeUndefined();
    expect(process.env[ENV.OLLAMA_THINK]).toBeUndefined();
    expect(process.env[ENV.OPENROUTER_TEMPERATURE]).toBeUndefined();
  });

  it('should apply the active ollama profile, overriding the run block cap', () => {
    const path = writeConfig({
      delegation: 'runner',
      activeProfile: 'a3b',
      run: { maxToolOutputChars: 48000 },
      profiles: {
        a3b: {
          backend: 'ollama',
          modelId: 'Qwen3-Coder-30B-A3B',
          baseUrl: 'http://127.0.0.1:11434',
          ollama: { numCtx: 65536, temperature: 0.2 },
          maxToolOutputChars: 64000,
        },
      },
    });

    loadRunnerConfig(path);

    expect(process.env[ENV.PROFILE]).toBe('local-default');
    expect(process.env[ENV.MODEL_ID]).toBe('Qwen3-Coder-30B-A3B');
    expect(process.env[ENV.BASE_URL]).toBe('http://127.0.0.1:11434');
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBe('65536');
    expect(process.env[ENV.OLLAMA_TEMPERATURE]).toBe('0.2');
    expect(process.env[ENV.MAX_TOOL_OUTPUT_CHARS]).toBe('64000');
  });

  it('should apply the active openrouter profile env', () => {
    const path = writeConfig({
      delegation: 'runner',
      activeProfile: 'cloud',
      profiles: {
        cloud: {
          backend: 'openrouter',
          modelId: 'qwen/qwen3.6-35b-a3b',
          openrouter: { allowFallbacks: true, temperature: 0.4 },
        },
      },
    });

    loadRunnerConfig(path);

    expect(process.env[ENV.PROFILE]).toBe('openrouter-default');
    expect(process.env[ENV.OPENROUTER_TEMPERATURE]).toBe('0.4');
  });

  it('should apply the run block but no profile env when activeProfile is absent', () => {
    const path = writeConfig({
      delegation: 'runner',
      run: { maxSteps: 25 },
      profiles: {
        a3b: { backend: 'ollama', modelId: 'Qwen3-Coder-30B-A3B', ollama: { numCtx: 65536 } },
      },
    });

    loadRunnerConfig(path);

    expect(process.env[ENV.MAX_STEPS]).toBe('25');
    expect(process.env[ENV.MODEL_ID]).toBeUndefined();
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBeUndefined();
    expect(process.env[ENV.PROFILE]).toBeUndefined();
  });

  it('should apply the old flat fields unchanged when no catalog fields are present', () => {
    const path = writeConfig({
      delegation: 'runner',
      provider: 'ollama',
      profile: 'local-default',
      modelId: 'qwen2.5-coder:7b',
      generateTimeoutMs: 90000,
      ollama: { numCtx: 32768 },
    });

    loadRunnerConfig(path);

    expect(process.env[ENV.PROVIDER]).toBe('ollama');
    expect(process.env[ENV.PROFILE]).toBe('local-default');
    expect(process.env[ENV.MODEL_ID]).toBe('qwen2.5-coder:7b');
    expect(process.env[ENV.GENERATE_TIMEOUT_MS]).toBe('90000');
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBe('32768');
  });

  it('should set RUNNER_GENERATE_MAX_TOTAL_MS when generateMaxTotalMs is present in config', () => {
    const path = writeConfig({ delegation: 'runner', generateMaxTotalMs: 600000 });

    loadRunnerConfig(path);

    expect(process.env['RUNNER_GENERATE_MAX_TOTAL_MS']).toBe('600000');
  });
});

describe('RunnerConfigSchema', () => {
  it('should reject a config missing the required delegation field', () => {
    expect(RunnerConfigSchema.safeParse({}).success).toBe(false);
  });

  it('should reject an unknown nested ollama key via strict', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      ollama: { numCtx: 1024, foo: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('should accept a config populating every new run-behavior field', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      maxSteps: 40,
      maxToolOutputChars: 64000,
      largeFileLines: 800,
      ollama: { numCtx: 65536, temperature: 0.2, think: false },
      openrouter: { allowFallbacks: true, temperature: 0.3, reasoningEffort: 'high' },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a full catalog config with activeProfile, run block, and 3 profiles', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      activeProfile: 'a3b',
      run: {
        generateTimeoutMs: 600000,
        maxSteps: 30,
        maxToolOutputChars: 48000,
        largeFileLines: 600,
      },
      profiles: {
        a3b: {
          backend: 'ollama',
          modelId: 'Qwen3-Coder-30B-A3B',
          baseUrl: 'http://127.0.0.1:11434',
          ollama: { numCtx: 65536, temperature: 0.2, think: false },
          maxToolOutputChars: 64000,
        },
        devstral: {
          backend: 'ollama',
          modelId: 'Devstral-24B',
          ollama: { numCtx: 32768 },
          maxSteps: 20,
        },
        cloud: {
          backend: 'openrouter',
          modelId: 'qwen/qwen3.6-35b-a3b',
          openrouter: { allowFallbacks: true, temperature: 0.3, reasoningEffort: 'high' },
          generateTimeoutMs: 300000,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a roleProfiles map of agent names to profile names', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      roleProfiles: { 'ts-test-writer': 'devstral', 'code-logic-writer': 'a3b' },
      profiles: {
        a3b: { backend: 'ollama', modelId: 'Qwen3-Coder-30B-A3B' },
        devstral: { backend: 'ollama', modelId: 'Devstral-24B' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept a valid profile but reject one with an unknown nested key', () => {
    const valid = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      profiles: { a3b: { backend: 'ollama', modelId: 'x' } },
    });
    expect(valid.success).toBe(true);

    const withBogus = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      profiles: { a3b: { backend: 'ollama', modelId: 'x', bogus: 1 } },
    });
    expect(withBogus.success).toBe(false);
  });
});

describe('RunnerConfigSchema referential integrity', () => {
  const catalogProfiles = {
    'a3b-code': { backend: 'ollama' as const, modelId: 'Qwen3-Coder-30B-A3B' },
    devstral: { backend: 'ollama' as const, modelId: 'Devstral-24B' },
  };

  it('should accept activeProfile and roleProfiles that reference defined profile keys', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      activeProfile: 'a3b-code',
      roleProfiles: { 'ts-test-writer': 'devstral', 'code-logic-writer': 'a3b-code' },
      profiles: catalogProfiles,
    });
    expect(result.success).toBe(true);
  });

  it('should reject an activeProfile that is not a defined profile key', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      activeProfile: 'a3b-cod',
      profiles: catalogProfiles,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('a3b-cod');
    expect(result.error.issues[0]?.message).toContain('is not a defined profile');
  });

  it('should reject a roleProfiles value that is not a defined profile key, with the agent key in the path', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      roleProfiles: { 'ts-test-writer': 'nope' },
      profiles: catalogProfiles,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['roleProfiles', 'ts-test-writer']);
  });

  it('should accept a flat config with no profiles (refinement does not fire)', () => {
    const result = RunnerConfigSchema.safeParse({
      delegation: 'runner',
      provider: 'ollama',
      roleProfiles: { 'ts-test-writer': 'whatever' },
    });
    expect(result.success).toBe(true);
  });

  it('should validate the committed runner.config.json and runner.config.example.json', () => {
    const live = RunnerConfigSchema.safeParse(JSON.parse(readFileSync('runner.config.json', 'utf8')));
    const example = RunnerConfigSchema.safeParse(
      JSON.parse(readFileSync('runner.config.example.json', 'utf8'))
    );
    expect(live.success).toBe(true);
    expect(example.success).toBe(true);
  });
});

describe('role-based profile selection', () => {
  let dir: string;
  let savedEnv: Record<string, string | undefined>;

  const writeConfig = (value: unknown): string => {
    const path = join(dir, 'runner.config.json');
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runner-roleprofile-'));
    savedEnv = Object.fromEntries(RUNNER_ENV_KEYS.map(k => [k, process.env[k]]));
    RUNNER_ENV_KEYS.forEach(k => delete process.env[k]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    RUNNER_ENV_KEYS.forEach(k => {
      const prior = savedEnv[k];
      if (prior === undefined) delete process.env[k];
      else process.env[k] = prior;
    });
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should return the parsed config from loadRunnerConfig', () => {
    const path = writeConfig({ delegation: 'runner', modelId: 'x' });

    const config = loadRunnerConfig(path);

    expect(config?.delegation).toBe('runner');
    expect(config?.modelId).toBe('x');
  });

  it('should return undefined from loadRunnerConfig when the file is missing', () => {
    const config = loadRunnerConfig(join(dir, 'nope.json'));

    expect(config).toBeUndefined();
  });

  it('should overwrite the baseline active profile with the role-selected profile env', () => {
    const path = writeConfig({
      delegation: 'runner',
      activeProfile: 'a3b',
      roleProfiles: { 'ts-test-writer': 'devstral' },
      profiles: {
        a3b: { backend: 'ollama', modelId: 'Qwen3-Coder-30B-A3B', ollama: { numCtx: 65536 } },
        devstral: { backend: 'ollama', modelId: 'Devstral-24B', ollama: { numCtx: 32768 } },
      },
    });
    const config = loadRunnerConfig(path);

    applyRoleProfile(config, 'ts-test-writer');

    expect(process.env[ENV.PROFILE]).toBe('local-default');
    expect(process.env[ENV.MODEL_ID]).toBe('Devstral-24B');
    expect(process.env[ENV.OLLAMA_NUM_CTX]).toBe('32768');
  });

  it('should leave the baseline active profile untouched for an agent not in roleProfiles', () => {
    const path = writeConfig({
      delegation: 'runner',
      activeProfile: 'a3b',
      roleProfiles: { 'ts-test-writer': 'devstral' },
      profiles: {
        a3b: { backend: 'ollama', modelId: 'Qwen3-Coder-30B-A3B' },
        devstral: { backend: 'ollama', modelId: 'Devstral-24B' },
      },
    });
    const config = loadRunnerConfig(path);

    applyRoleProfile(config, 'ui-writer');

    expect(process.env[ENV.MODEL_ID]).toBe('Qwen3-Coder-30B-A3B');
  });

  it('should no-op applyRoleProfile when config is undefined', () => {
    applyRoleProfile(undefined, 'ts-test-writer');

    expect(process.env[ENV.MODEL_ID]).toBeUndefined();
  });

  it('should apply an openrouter-backed profile via applyProfileByName', () => {
    const config = RunnerConfigSchema.parse({
      delegation: 'runner',
      profiles: {
        cloud: {
          backend: 'openrouter',
          modelId: 'qwen/qwen3.6-35b-a3b',
          openrouter: { allowFallbacks: true, temperature: 0.4 },
        },
      },
    });

    applyProfileByName(config, 'cloud');

    expect(process.env[ENV.PROFILE]).toBe('openrouter-default');
    expect(process.env[ENV.MODEL_ID]).toBe('qwen/qwen3.6-35b-a3b');
    expect(process.env[ENV.OPENROUTER_TEMPERATURE]).toBe('0.4');
  });

  it('should no-op applyProfileByName when the named profile is absent', () => {
    const config = RunnerConfigSchema.parse({ delegation: 'runner' });

    applyProfileByName(config, 'missing');

    expect(process.env[ENV.MODEL_ID]).toBeUndefined();
  });
});
