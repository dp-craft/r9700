import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  type AgentRunResult,
  type AgentType,
  applyRoleProfile,
  buildCapabilities,
  createProgress,
  debugEnabled,
  initTracing,
  loadRunnerConfig,
  type Progress,
  type RunMode,
  runTask,
  type RunTaskInput,
  SUPPORTED_AGENT_TYPES,
  withParentContext
} from '../core';
import { loadDotEnvDefaults } from './bootstrap';

export { dotEnvDefaults, isTracingOwnedKey, loadDotEnvDefaults } from './bootstrap';

const FLAG_AGENT = '--agent';
const FLAG_NAV = '--nav';
const FLAG_MODE = '--mode';
const FLAG_PROFILE = '--profile';
const FLAG_RULES = '--rules';
const FLAG_OUT = '--out';
const FLAG_CAPABILITIES = '--capabilities';
const FLAG_DEBUG = '--debug';

// Env fallback for the profile (provider/backend) selection. The `--profile`
// CLI flag still wins; this lets the implement.sh launch menu pick the
// provider (ollama|openrouter → local-default|openrouter-default) without a flag.
const ENV_PROFILE = 'RUNNER_PROFILE';

const UNKNOWN_MODEL_ID = 'unknown';

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

// Single source of truth for accepted agent types: the executor's allow-list,
// which is also what `--capabilities` advertises (no cli-vs-capabilities drift).
const AGENT_TYPES: readonly AgentType[] = SUPPORTED_AGENT_TYPES;
const RUN_MODES: readonly RunMode[] = ['impl', 'tdd'];

const USAGE = `usage: runner ${FLAG_AGENT} <${AGENT_TYPES.join('|')}> ${FLAG_NAV} <path> ${FLAG_MODE} <${RUN_MODES.join('|')}> [${FLAG_PROFILE} <name>] [${FLAG_RULES} <path>] [${FLAG_OUT} <path>] [${FLAG_DEBUG}]\n   or: runner ${FLAG_CAPABILITIES}   (print the machine-readable runner contract as JSON, exit 0)`;

const isAgentType = (value: string | undefined): value is AgentType =>
  value !== undefined && (AGENT_TYPES as readonly string[]).includes(value);

const isRunMode = (value: string | undefined): value is RunMode =>
  value !== undefined && (RUN_MODES as readonly string[]).includes(value);

const readFlag = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const envProfile = (): string | undefined => {
  const value = process.env[ENV_PROFILE];
  return value !== undefined && value !== '' ? value : undefined;
};

const parseInput = (argv: readonly string[]): RunTaskInput | undefined => {
  const agentType = readFlag(argv, FLAG_AGENT);
  const navBundle = readFlag(argv, FLAG_NAV);
  const mode = readFlag(argv, FLAG_MODE);
  const profileName = readFlag(argv, FLAG_PROFILE) ?? envProfile();
  const rulesPath = readFlag(argv, FLAG_RULES);
  if (!isAgentType(agentType) || !isRunMode(mode) || navBundle === undefined) {
    return undefined;
  }
  const base: RunTaskInput = { agentType, navBundle, mode };
  return {
    ...base,
    ...(profileName !== undefined ? { profileName } : {}),
    ...(rulesPath !== undefined ? { rulesPath } : {}),
  };
};

const emitResult = async (result: AgentRunResult, outPath: string | undefined): Promise<void> => {
  const json = JSON.stringify(result);
  console.log(json);
  if (outPath !== undefined) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, json, 'utf8');
  }
};

export const interruptedResult = (agentType: AgentType, signal: string): AgentRunResult => ({
  status: 'failed',
  agentType,
  touchedFiles: [],
  finalRung: 'ollama',
  failureClass: 'interrupted',
  escalated: false,
  // An external interrupt (the orchestrator's own wall-clock kill) is not a
  // sanctioned model-failure fallback — the orchestrator decides what to do.
  fallbackSanctioned: false,
  attempts: 0,
  redObserved: false,
  greenObserved: false,
  modelId: UNKNOWN_MODEL_ID,
  error: `interrupted by ${signal} (wall-clock timeout)`,
});

export const createEmitOnce = (
  emit: (r: AgentRunResult, out: string | undefined) => Promise<void>
): ((r: AgentRunResult, out: string | undefined) => Promise<void>) => {
  let done = false;
  return async (r: AgentRunResult, out: string | undefined): Promise<void> => {
    if (done) return;
    done = true;
    await emit(r, out);
  };
};

export const handleInterrupt = async (
  signal: string,
  ctx: {
    readonly agentType: AgentType;
    readonly outPath: string | undefined;
    readonly emit: (r: AgentRunResult, out: string | undefined) => Promise<void>;
  }
): Promise<AgentRunResult> => {
  const result = interruptedResult(ctx.agentType, signal);
  await ctx.emit(result, ctx.outPath);
  return result;
};

const resolveAgentType = (argv: readonly string[]): AgentType => {
  const value = readFlag(argv, FLAG_AGENT);
  return isAgentType(value) ? value : 'code-logic-writer';
};

export async function main(
  argv: readonly string[],
  emit: (r: AgentRunResult, out: string | undefined) => Promise<void> = emitResult,
  progress: Progress = createProgress(false)
): Promise<number> {
  if (argv.includes(FLAG_CAPABILITIES)) {
    console.log(JSON.stringify(buildCapabilities()));
    return EXIT_SUCCESS;
  }
  const input = parseInput(argv);
  if (input === undefined) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const outPath = readFlag(argv, FLAG_OUT);
  try {
    const result = await runTask(input, progress);
    await emit(result, outPath);
    return result.status === 'completed' ? EXIT_SUCCESS : EXIT_FAILURE;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const terminal: AgentRunResult = {
      status: 'failed',
      agentType: input.agentType,
      touchedFiles: [],
      finalRung: 'ollama',
      failureClass: 'fatal',
      escalated: false,
      fallbackSanctioned: false,
      attempts: 0,
      redObserved: false,
      greenObserved: false,
      modelId: UNKNOWN_MODEL_ID,
      error: message,
    };
    await emit(terminal, outPath);
    return EXIT_FAILURE;
  }
}

const entryUrl = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : undefined;
if (import.meta.url === entryUrl) {
  const config = loadRunnerConfig();
  loadDotEnvDefaults();
  let settled = false;
  const argv = process.argv.slice(2);
  const outPath = readFlag(argv, FLAG_OUT);
  const agentType = resolveAgentType(argv);
  // Role→profile env selection (config-authoritative) BEFORE parseInput reads
  // RUNNER_PROFILE; an explicit --profile flag still wins inside parseInput.
  applyRoleProfile(config, agentType);
  const tracing = initTracing();
  const progress = createProgress(debugEnabled(argv));

  const emitOnce = createEmitOnce(emitResult);

  const onSignal = (signal: string) => (): void => {
    if (settled) {
      process.exit(EXIT_FAILURE);
    }
    handleInterrupt(signal, { agentType, outPath, emit: emitOnce })
      .then(() => tracing.shutdown())
      .then(() => process.exit(EXIT_FAILURE))
      .catch(() => process.exit(EXIT_FAILURE));
  };

  process.once('SIGTERM', onSignal('SIGTERM'));
  process.once('SIGINT', onSignal('SIGINT'));

  const onFatal = (err: unknown): void => {
    console.error('[runner] fatal:', err);
    if (settled) {
      process.exit(EXIT_FAILURE);
    }
    settled = true;
    void tracing
      .shutdown()
      .catch(() => {})
      .then(() => process.exit(EXIT_FAILURE));
  };

  process.once('uncaughtException', onFatal);
  process.once('unhandledRejection', onFatal);

  withParentContext(() => main(argv, emitOnce, progress))
    .then(async (code): Promise<number> => {
      await tracing.shutdown();
      return code;
    })
    .then(code => {
      settled = true;
      process.exit(code);
    })
    .catch(async () => {
      settled = true;
      await tracing.shutdown().catch(() => {});
      process.exit(EXIT_FAILURE);
    });
}
