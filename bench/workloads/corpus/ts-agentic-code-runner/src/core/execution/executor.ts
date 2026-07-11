import type { AgentRunResult, AgentType } from '../shared';

// HARD SAFETY CIRCUIT-BREAKER — not a per-task sizing constraint.
// The real runaway guard is the sandbox (isAllowedTarget in tools/index.ts): a model
// can only edit declared targetFiles, so mass-corruption is structurally impossible
// regardless of this number. The task-dag nav bundle is the authoritative per-task
// scope. This cap exists ONLY to fail fast against a pathological declaration (an
// extractTargetFiles bug / accidental repo-glob) before any model runs. No legitimate
// single runner task declares >50 files.
export const MAX_TARGET_FILES = 50;

export const SUPPORTED_AGENT_TYPES: readonly AgentType[] = [
  'code-logic-writer',
  'ts-test-writer',
  'ui-writer',
];

export interface ExistingTest {
  readonly path: string;
  readonly describeItTree: readonly string[];
}

export interface CollaboratorSignature {
  readonly name: string;
  readonly signature: string;
}

export interface Collaborators {
  readonly signatures: readonly CollaboratorSignature[];
  readonly siblingBody: { readonly name: string; readonly body: string } | null;
  readonly typeShapes?: readonly {
    readonly name: string;
    readonly shape: string;
    readonly importPath?: string;
  }[];
}

export interface TaskSpec {
  readonly agentType: AgentType;
  readonly navBundlePath: string;
  readonly targetFiles: readonly string[];
  readonly existingTests?: readonly ExistingTest[];
  readonly collaborators?: Collaborators;
  readonly taskStatement?: string;
  readonly specExcerpts?: readonly string[];
  readonly requirementDetails?: readonly string[];
  readonly planRows?: readonly string[];
}

export class FootprintError extends Error {}

const isSupportedAgentType = (agentType: AgentType): boolean =>
  SUPPORTED_AGENT_TYPES.includes(agentType);

export function assertFootprint(spec: TaskSpec): void {
  if (spec.targetFiles.length === 0) {
    throw new FootprintError(
      'Task footprint is empty — no target files found in the nav bundle ' +
        '(planContext/sources/excerpts); cannot run.'
    );
  }
  if (spec.targetFiles.length > MAX_TARGET_FILES) {
    throw new FootprintError(
      `Task footprint of ${spec.targetFiles.length} files exceeds the max of ${MAX_TARGET_FILES}`
    );
  }
  if (!isSupportedAgentType(spec.agentType)) {
    throw new FootprintError(`Unsupported agent type: ${spec.agentType}`);
  }
}

export async function executeTask(spec: TaskSpec): Promise<AgentRunResult> {
  assertFootprint(spec);
  const result: AgentRunResult = {
    status: 'completed',
    agentType: spec.agentType,
    touchedFiles: spec.targetFiles,
    finalRung: 'ollama',
    escalated: false,
    fallbackSanctioned: false,
    attempts: 1,
    redObserved: false,
    greenObserved: false,
    modelId: 'unknown',
  };
  return result;
}
