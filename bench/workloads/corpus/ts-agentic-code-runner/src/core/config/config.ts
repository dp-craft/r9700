import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import { DEFAULT_PROFILE_NAME, OPENROUTER_PROFILE_NAME } from '../profiles';
import { ENV } from '../shared';

// Single owner of the runner's global timeout default (20 min). One value governs
// the per-step abort timer AND the HTTP client idle timeouts (see connector.ts),
// and seeds the generated config's `generateTimeoutMs`. Override per-launch via the
// `generateTimeoutMs` config field / RUNNER_GENERATE_TIMEOUT_MS env.
export const DEFAULT_GENERATE_TIMEOUT_MS = 1_200_000;

// Owns the schema for the runner's per-launch config (`runner.config.json` at
// the project root). A separate generator CLI imports this schema to author the
// file; the runner loads it AUTHORITATIVELY (overwrites process.env) so launch
// settings survive the tmux→orchestrator→Bash chain where env is unreliable.
// Reusable per-model sampling/cap sub-schemas, shared by the flat back-compat
// fields AND the per-model PROFILES catalog (`profiles.<name>`).
const OllamaParams = z
  .object({
    numCtx: z.number().optional(),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    repeatPenalty: z.number().optional(),
    numPredict: z.number().optional(),
    idleTimeoutMs: z.number().optional(),
    think: z.boolean().optional(),
  })
  .strict();

const OpenrouterParams = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().optional(),
    minP: z.number().optional(),
    repetitionPenalty: z.number().optional(),
    reasoningMaxTokens: z.number().optional(),
    reasoningEffort: z.string().optional(),
    cacheControl: z.string().optional(),
    allowFallbacks: z.boolean().optional(),
    provider: z.string().optional(),
    quantization: z.string().optional(),
  })
  .strict();

// The four run-behavior caps, shared by the top-level flat fields, the `run`
// block (catalog default), and per-profile overrides.
const capFields = {
  generateTimeoutMs: z.number().int().positive().optional(),
  maxSteps: z.number().int().positive().optional(),
  maxToolOutputChars: z.number().int().positive().optional(),
  largeFileLines: z.number().int().positive().optional(),
};

const ProfileSchema = z
  .object({
    backend: z.enum(['ollama', 'openrouter', 'openai-compatible']),
    modelId: z.string().min(1),
    baseUrl: z.string().optional(),
    ollama: OllamaParams.optional(),
    openrouter: OpenrouterParams.optional(),
    ...capFields,
  })
  .strict();

export const RunnerConfigSchema = z
  .object({
    delegation: z.enum(['runner', 'claude']),
    provider: z.enum(['openrouter', 'ollama']).optional(),
    profile: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    generateMaxTotalMs: z.number().int().positive().optional(),
    ...capFields,
    ollama: OllamaParams.optional(),
    openrouter: OpenrouterParams.extend({ allowFallbacks: z.boolean() }).strict().optional(),
    activeProfile: z.string().min(1).optional(),
    run: z.object(capFields).strict().optional(),
    profiles: z.record(z.string(), ProfileSchema).optional(),
    roleProfiles: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const profileKeys = Object.keys(config.profiles ?? {});
    if (profileKeys.length === 0) return;
    const isDefined = (name: string): boolean => profileKeys.includes(name);
    if (config.activeProfile !== undefined && !isDefined(config.activeProfile)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activeProfile'],
        message: `activeProfile "${config.activeProfile}" is not a defined profile`,
      });
    }
    Object.entries(config.roleProfiles ?? {}).forEach(([agentKey, profileName]) => {
      if (isDefined(profileName)) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roleProfiles', agentKey],
        message: `roleProfiles["${agentKey}"] = "${profileName}" is not a defined profile`,
      });
    });
  });

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>;
type ProfileEntry = z.infer<typeof ProfileSchema>;
type OpenrouterConfig = z.infer<typeof OpenrouterParams>;
type CapFields = z.infer<z.ZodObject<typeof capFields>>;

const setEnv = (key: string, value: string | undefined): void => {
  if (value !== undefined) process.env[key] = value;
};

// I/O boundary: applies each present field to process.env, overwriting any
// stale value (config is authoritative over the env it ends up shaping).
const setNum = (key: string, value: number | undefined): void => {
  setEnv(key, value === undefined ? undefined : String(value));
};

const applyOllamaConfig = (ollama: NonNullable<RunnerConfig['ollama']>): void => {
  setNum(ENV.OLLAMA_NUM_CTX, ollama.numCtx);
  setNum(ENV.OLLAMA_TEMPERATURE, ollama.temperature);
  setNum(ENV.OLLAMA_TOP_P, ollama.topP);
  setNum(ENV.OLLAMA_TOP_K, ollama.topK);
  setNum(ENV.OLLAMA_REPEAT_PENALTY, ollama.repeatPenalty);
  setNum(ENV.OLLAMA_NUM_PREDICT, ollama.numPredict);
  setNum(ENV.OLLAMA_IDLE_TIMEOUT_MS, ollama.idleTimeoutMs);
  setEnv(ENV.OLLAMA_THINK, ollama.think === undefined ? undefined : String(ollama.think));
};

const applyOpenrouterConfig = (openrouter: OpenrouterConfig): void => {
  const fallbacks = openrouter.allowFallbacks;
  setEnv(ENV.OPENROUTER_ALLOW_FALLBACKS, fallbacks === undefined ? undefined : String(fallbacks));
  setEnv(ENV.OPENROUTER_PROVIDER, openrouter.provider);
  setEnv(ENV.OPENROUTER_QUANTIZATION, openrouter.quantization);
  setEnv(ENV.OPENROUTER_CACHE_CONTROL, openrouter.cacheControl);
  setEnv(ENV.OPENROUTER_REASONING_EFFORT, openrouter.reasoningEffort);
  setNum(ENV.OPENROUTER_TEMPERATURE, openrouter.temperature);
  setNum(ENV.OPENROUTER_TOP_P, openrouter.topP);
  setNum(ENV.OPENROUTER_TOP_K, openrouter.topK);
  setNum(ENV.OPENROUTER_MIN_P, openrouter.minP);
  setNum(ENV.OPENROUTER_REPETITION_PENALTY, openrouter.repetitionPenalty);
  setNum(ENV.OPENROUTER_REASONING_MAX_TOKENS, openrouter.reasoningMaxTokens);
};

const applyCaps = (caps: CapFields): void => {
  setNum(ENV.GENERATE_TIMEOUT_MS, caps.generateTimeoutMs);
  setNum(ENV.MAX_STEPS, caps.maxSteps);
  setNum(ENV.MAX_TOOL_OUTPUT_CHARS, caps.maxToolOutputChars);
  setNum(ENV.LARGE_FILE_LINES, caps.largeFileLines);
};

const baseProfileFor = (backend: ProfileEntry['backend']): string => {
  if (backend === 'openrouter') return OPENROUTER_PROFILE_NAME;
  if (backend === 'openai-compatible') return 'vllm-qwen-coder';
  return DEFAULT_PROFILE_NAME;
};

const applyProfile = (profile: ProfileEntry): void => {
  setEnv(ENV.PROFILE, baseProfileFor(profile.backend));
  setEnv(ENV.MODEL_ID, profile.modelId);
  setEnv(ENV.BASE_URL, profile.baseUrl);
  if (profile.ollama !== undefined) applyOllamaConfig(profile.ollama);
  if (profile.openrouter !== undefined) applyOpenrouterConfig(profile.openrouter);
  applyCaps(profile);
};

// Applies the named profile from the catalog (RUNNER_PROFILE base-builtin +
// model id + base url + sampling/caps). No-op when the name is absent.
export const applyProfileByName = (config: RunnerConfig, name: string): void => {
  const profile = config.profiles?.[name];
  if (profile !== undefined) applyProfile(profile);
};

// Config-authoritative role→profile override: if the agent's role names a
// catalog profile, applies it OVER the baseline active-profile env. No-op
// otherwise (manual --profile / active-profile selection stands).
export const applyRoleProfile = (config: RunnerConfig | undefined, agentType: string): void => {
  const name = config?.roleProfiles?.[agentType];
  if (config !== undefined && name !== undefined) applyProfileByName(config, name);
};

const applyActiveProfile = (config: RunnerConfig): void => {
  const name = config.activeProfile;
  if (name !== undefined) applyProfileByName(config, name);
};

const applyRunnerConfig = (config: RunnerConfig): void => {
  setEnv(ENV.DELEGATION, config.delegation);
  setEnv(ENV.PROVIDER, config.provider);
  setEnv(ENV.PROFILE, config.profile);
  setEnv(ENV.MODEL_ID, config.modelId);
  setNum(ENV.GENERATE_MAX_TOTAL_MS, config.generateMaxTotalMs);
  applyCaps(config);
  if (config.ollama !== undefined) applyOllamaConfig(config.ollama);
  if (config.openrouter !== undefined) applyOpenrouterConfig(config.openrouter);
  if (config.run !== undefined) applyCaps(config.run);
  applyActiveProfile(config);
};

export const loadRunnerConfig = (path = 'runner.config.json'): RunnerConfig | undefined => {
  if (!existsSync(path)) return undefined;
  const parsed = RunnerConfigSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    console.error(`[runner] invalid runner.config.json: ${parsed.error.message}`);
    return undefined;
  }
  applyRunnerConfig(parsed.data);
  return parsed.data;
};
