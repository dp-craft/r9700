import { MAX_TARGET_FILES, SUPPORTED_AGENT_TYPES } from '../execution';
import { resolveMaxComplexity } from '../gates';
import {
  BUILTIN_PROFILES,
  DEFAULT_PROFILE_NAME,
  ENV_BASE_URL_KEY,
  ENV_MODEL_ID_KEY,
  ENV_PROFILE_KEY,
  ENV_RULES_PATH_KEY
} from '../profiles';
import type { AgentType, BackendKind, RungName, RunMode } from '../shared';
import { LADDERS } from './escalation';
import { PIPELINES, type Stage, STAGE_NAME } from './pipeline';

// Machine-readable runner contract. The orchestrator queries this instead of
// grepping the runner's source / probing the filesystem (see README §Orchestrator
// Contract). Bump the schema version on any breaking field change.
export const CAPABILITIES_SCHEMA = 'runner-capabilities/v2';

// `tsx` entrypoint — the runner is NOT compiled to dist (fix: no build step,
// the orchestrator MUST NOT probe tools/agentic-code-runner/dist/).
export const RUNNER_BUILD = 'none (tsx)';

export interface ProfileSummary {
  readonly name: string;
  readonly backend: BackendKind;
  readonly modelId: string;
  readonly default: boolean;
}

export interface EnvVarSummary {
  readonly key: string;
  readonly purpose: string;
}

export interface RunnerCapabilities {
  readonly schema: typeof CAPABILITIES_SCHEMA;
  readonly build: typeof RUNNER_BUILD;
  readonly entrypoint: string;
  readonly agentTypes: readonly AgentType[];
  readonly modes: readonly RunMode[];
  readonly maxTargetFiles: number;
  readonly gatesByMode: Readonly<Record<RunMode, readonly string[]>>;
  readonly complexityCap: number;
  readonly escalation: {
    readonly ladders: Readonly<Record<'ollama' | 'openrouter', readonly RungName[]>>;
    readonly advancesRungOn: 'connectivity-error-only';
    readonly note: string;
  };
  readonly profiles: readonly ProfileSummary[];
  readonly env: readonly EnvVarSummary[];
}

const RUNNER_MODES = Object.keys(PIPELINES) as readonly RunMode[];

const ENTRYPOINT =
  'npm run runner -- --agent <code-logic-writer|ts-test-writer|ui-writer> ' +
  '--nav <path> --mode <impl|tdd> [--profile <name>] [--rules <path>] [--out <path>]';

const ESCALATION_NOTE =
  'Two independent base ladders: each base tier (ollama OR openrouter) escalates ' +
  'directly to the terminal claude handoff rung — there is NO ollama→openrouter ' +
  'cross-fallback. Reaching it yields status local-exhausted: the local ladder is ' +
  'spent and the task is handed off for orchestrator/human review (NOT billed to ' +
  'Claude). Rungs advance ONLY on a connectivity error; a no-progress / gate-fail ' +
  'halts at the current rung with fallbackSanctioned=true. A connectivity failure is ' +
  'a HARD STOP (fallbackSanctioned=false) — fix the provider, do not hand off for review.';

const gatesForMode = (mode: RunMode): readonly string[] =>
  PIPELINES[mode].map((stage: Stage): string => STAGE_NAME.get(stage) ?? 'unknown');

const gatesByMode = (): Readonly<Record<RunMode, readonly string[]>> =>
  Object.fromEntries(RUNNER_MODES.map((mode): [RunMode, readonly string[]] => [mode, gatesForMode(mode)])) as Record<
    RunMode,
    readonly string[]
  >;

const profileSummaries = (): readonly ProfileSummary[] =>
  Object.values(BUILTIN_PROFILES).map(
    (profile): ProfileSummary => ({
      name: profile.name,
      backend: profile.backend,
      modelId: profile.modelId,
      default: profile.name === DEFAULT_PROFILE_NAME,
    })
  );

const ENV_VARS: readonly EnvVarSummary[] = [
  { key: ENV_PROFILE_KEY, purpose: 'select the model profile / provider (also via --profile)' },
  { key: ENV_MODEL_ID_KEY, purpose: 'override the resolved profile\'s model id' },
  { key: ENV_BASE_URL_KEY, purpose: 'override the backend base URL' },
  { key: ENV_RULES_PATH_KEY, purpose: 'custom rules .md (also via --rules)' },
  { key: 'RUNNER_MAX_COMPLEXITY', purpose: 'cyclomatic-complexity gate cap (default 5)' },
  { key: 'RUNNER_IDLE_TIMEOUT_MS', purpose: 'idle-stall abort window (ms)' },
  { key: 'RUNNER_MAX_STEPS', purpose: 'per-drive tool-loop step cap (default 32)' },
  {
    key: 'RUNNER_MAX_TOOL_OUTPUT_CHARS',
    purpose: 'per-tool-result truncation cap (default 16000)',
  },
  {
    key: 'RUNNER_COMPACTION_WINDOW',
    purpose: 'large tool-results kept verbatim before in-loop compaction (default 10; 0 disables)',
  },
  {
    key: 'RUNNER_OPENROUTER_CACHE_CONTROL',
    purpose: 'opt-in OpenRouter ephemeral prompt caching (Anthropic-routed models only)',
  },
  { key: 'RUNNER_TRACING', purpose: 'emit OpenTelemetry spans when "1"' },
  { key: 'OPENROUTER_API_KEY', purpose: 'required for the openrouter backend' },
];

// Build the contract from the live runtime constants (executor / pipeline /
// gates / escalation / profiles) so it can never drift from real behaviour.
export const buildCapabilities = (): RunnerCapabilities => ({
  schema: CAPABILITIES_SCHEMA,
  build: RUNNER_BUILD,
  entrypoint: ENTRYPOINT,
  agentTypes: [...SUPPORTED_AGENT_TYPES],
  modes: [...RUNNER_MODES],
  maxTargetFiles: MAX_TARGET_FILES,
  gatesByMode: gatesByMode(),
  complexityCap: resolveMaxComplexity(),
  escalation: {
    ladders: { ollama: [...LADDERS.ollama], openrouter: [...LADDERS.openrouter] },
    advancesRungOn: 'connectivity-error-only',
    note: ESCALATION_NOTE,
  },
  profiles: profileSummaries(),
  env: ENV_VARS,
});
