import { buildEditRegionDirective } from '../execution';
import { assertFootprint, type TaskSpec } from '../execution';
import { checkTargetsClean, defaultRunTests } from '../gates';
import type { ConnectorDeps } from '../llm';
import { resolveProfile } from '../profiles';
import {
  buildCollaboratorsBlock,
  buildKickoff,
  buildPlanRowsBlock,
  buildRequirementDetailsBlock,
  buildSpecExcerptsBlock,
  buildSystemPrompt,
  buildTestKickoff,
  selectCodeKickoff,
  TDD_IMPL_KICKOFF_PROMPT
} from '../prompt';
import { createProgress, type Progress, recordTelemetry } from '../reporting';
import { dirtyTreeResult, fatalResult, toRunResult } from '../result';
import { emptySpecResult } from '../result';
import type { ProjectRulesFn } from '../rules';
import type { AgentRunResult, AgentType, RunMode } from '../shared';
import { buildNavBundleLookup, parseNavBundle } from '../tools';
import { runEscalation } from './escalationLoop';

// Re-export shim: emptySpecResult moved to ../result. runTask.ts imports it from
// ./runner and the runTask test mocks './runner', so it MUST remain exported here.
export { emptySpecResult };

// Re-export shims: gate glue moved to ../gates. Tests import these from ./runner.
export { checkTargetsClean, defaultRunTests };

// Re-export shims: prompt-assembly functions moved to ../prompt. These keep existing
// importers (barrel + test files) resolving via ./runner. Temporary — removed later.
export {
  buildCollaboratorsBlock,
  buildKickoff,
  buildPlanRowsBlock,
  buildRequirementDetailsBlock,
  buildSpecExcerptsBlock,
  buildSystemPrompt,
  buildTestKickoff,
  selectCodeKickoff,
  TDD_IMPL_KICKOFF_PROMPT
};

// Re-export shims: escalation loop moved to ./escalationLoop. Tests + barrel import
// these from ./runner, so they MUST remain exported here.
export type { BuildOutcomeOpts } from './escalationLoop';
export {
  buildOutcome,
  CONTEXT_OVERFLOW_FRACTION,
  LLM_CONCLUSION_ENV,
  resolveBonSamples,
  resolveConclusionSummarizer,
  resolveMaxSteps,
  shouldRunBestOfN
} from './escalationLoop';

export interface RunnerDeps {
  readonly profileName?: string;
  readonly mode: RunMode;
  readonly runTests?: () => Promise<{ readonly passed: boolean; readonly output: string; readonly noTests: boolean }>;
  readonly progress?: Progress;
  readonly onBeforeAttempt?: (reset: boolean) => Promise<void>;
  // Injected service boundaries (functional DI): the composition root supplies
  // the concrete LLM connector + rules projector so this controller imports
  // neither `./connector` nor `./rulesProjection`.
  readonly connector: ConnectorDeps;
  readonly projectRules: ProjectRulesFn;
}

// Maps the CODE role (spec.agentType) to its TEST-writer role and whether the
// structural FP gates (decomposition, functional-style) apply. UI tasks skip the
// FP gates because JSX/hooks legitimately violate "no loops / no let" rules.
export interface RoleProfile {
  readonly testRole: AgentType;
  readonly structuralGates: boolean;
}

export const ROLE_PROFILES: Record<AgentType, RoleProfile> = {
  'code-logic-writer': { testRole: 'ts-test-writer', structuralGates: true },
  'ui-writer': { testRole: 'ts-test-writer', structuralGates: false },
  'ts-test-writer': { testRole: 'ts-test-writer', structuralGates: true },
  'lint-fix-loop': { testRole: 'ts-test-writer', structuralGates: true },
};

// Thrown when a target file already differs from HEAD at run start. Carries the
// scoped file list so the catch can produce a diagnosable dirty-tree result.
export class DirtyTreeError extends Error {
  readonly files: readonly string[];
  constructor(files: readonly string[]) {
    super(`dirty-tree: ${files.join(', ')}`);
    this.name = 'DirtyTreeError';
    this.files = files;
  }
}

const runGuarded = async (spec: TaskSpec, deps: RunnerDeps): Promise<AgentRunResult> => {
  try {
    assertFootprint(spec);
    const verdict = await checkTargetsClean(spec.targetFiles);
    if (!verdict.clean) {
      throw new DirtyTreeError(spec.targetFiles);
    }
    const baseProfile = resolveProfile(deps.profileName);
    const profile = ROLE_PROFILES[spec.agentType];
    const editDirective = await buildEditRegionDirective(spec);
    const navLookup = buildNavBundleLookup(await parseNavBundle(spec.navBundlePath));
    const codeSystem = buildSystemPrompt(
      spec,
      spec.agentType,
      (await deps.projectRules(spec.agentType)).condensedRules,
      editDirective
    );
    const testSystem = buildSystemPrompt(
      spec,
      profile.testRole,
      (await deps.projectRules(profile.testRole)).condensedRules
    );
    (deps.progress ?? createProgress(false)).event('rules', 'projected');
    const outcome = await runEscalation(
      spec,
      deps,
      baseProfile,
      { test: testSystem, code: codeSystem },
      profile.structuralGates,
      navLookup
    );
    return toRunResult(spec, deps.mode, outcome, baseProfile);
  } catch (cause) {
    if (cause instanceof DirtyTreeError) {
      return dirtyTreeResult(spec, cause.files);
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return fatalResult(spec, message);
  }
};

export async function runAgentLoop(spec: TaskSpec, deps: RunnerDeps): Promise<AgentRunResult> {
  const progress = deps.progress ?? createProgress(false);
  const startedAt = Date.now();
  const result = await runGuarded(spec, deps);
  recordTelemetry(result, startedAt, progress);
  progress.event('result', `${result.status} rung=${result.finalRung} attempts=${result.attempts}`);
  return result;
}
