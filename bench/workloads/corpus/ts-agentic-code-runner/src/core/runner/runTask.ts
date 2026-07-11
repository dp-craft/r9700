import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import type { Collaborators, CollaboratorSignature, ExistingTest, TaskSpec } from '../execution';
import { createModel, generate, resolveOllamaNumCtx } from '../llm';
import { ENV_BASE_URL_KEY, ENV_MODEL_ID_KEY, ENV_RULES_PATH_KEY } from '../profiles';
import { createProgress, type Progress } from '../reporting';
import { projectRules } from '../rules';
import type { AgentRunResult, AgentType, RunMode } from '../shared';
import { emptySpecResult, runAgentLoop } from './runner';

export interface RunTaskInput {
  readonly agentType: AgentType;
  readonly navBundle: string;
  readonly mode: RunMode;
  readonly profileName?: string;
  readonly modelId?: string;
  readonly baseUrl?: string;
  readonly rulesPath?: string;
}

// Forward an explicit model-id/baseUrl override down to resolveProfile via the env
// contract it already reads (T008). No-op when the input carries no override, so
// any pre-set env override still applies unchanged.
const applyOverride = (input: RunTaskInput): void => {
  if (input.modelId !== undefined) {
    process.env[ENV_MODEL_ID_KEY] = input.modelId;
  }
  if (input.baseUrl !== undefined) {
    process.env[ENV_BASE_URL_KEY] = input.baseUrl;
  }
  if (input.rulesPath !== undefined) {
    process.env[ENV_RULES_PATH_KEY] = input.rulesPath;
  }
};

const SOURCE_PATH = /`([^`]*\/[^`]*\.tsx?)`/g;

const isSourcePath = (value: unknown): value is string =>
  typeof value === 'string' && value.includes('/') && /\.tsx?$/.test(value);

const fromExcerpts = (navJson: unknown): readonly string[] => {
  const excerpts = (navJson as { specExcerpts?: readonly { text?: string }[] })?.specExcerpts ?? [];
  return excerpts.flatMap(excerpt =>
    [...(excerpt.text ?? '').matchAll(SOURCE_PATH)].map(match => match[1])
  );
};

const fromGates = (navJson: unknown): readonly string[] => {
  const reqs =
    (navJson as { requirements?: readonly { gate?: { target?: unknown } }[] })?.requirements ?? [];
  return reqs.map(req => req.gate?.target).filter(isSourcePath);
};

const fromPlanContext = (navJson: unknown): readonly string[] => {
  const ctx =
    (navJson as { planContext?: readonly { file?: unknown }[] })?.planContext ?? [];
  return [...new Set(ctx.map(row => row.file).filter(isSourcePath))];
};

const fromSources = (navJson: unknown): readonly string[] => {
  const srcs =
    (navJson as { sources?: readonly { path?: unknown }[] })?.sources ?? [];
  return srcs
    .map(s => s.path)
    .filter(isSourcePath)
    .filter((p): p is string => !p.startsWith('/'));
};

export const extractTargetFiles = (navJson: unknown): readonly string[] => {
  const planCtx = fromPlanContext(navJson);
  if (planCtx.length >= 1) return planCtx;

  const srcs = fromSources(navJson);
  if (srcs.length >= 1) return [...new Set(srcs)];

  return [...new Set([...fromExcerpts(navJson), ...fromGates(navJson)])];
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string');

const toExistingTest = (entry: unknown): ExistingTest | null => {
  const e = entry as { path?: unknown; describeItTree?: unknown };
  if (typeof e?.path !== 'string' || !isStringArray(e.describeItTree)) return null;
  return { path: e.path, describeItTree: e.describeItTree };
};

export const extractExistingTests = (navJson: unknown): readonly ExistingTest[] => {
  const tests = (navJson as { existingTests?: unknown })?.existingTests;
  if (!Array.isArray(tests)) return [];
  return tests.map(toExistingTest).filter((t): t is ExistingTest => t !== null);
};

const toCollaboratorSignature = (entry: unknown): CollaboratorSignature | null => {
  const e = entry as { name?: unknown; signature?: unknown };
  if (typeof e?.name !== 'string' || typeof e.signature !== 'string') return null;
  return { name: e.name, signature: e.signature };
};

const toSiblingBody = (
  value: unknown
): { readonly name: string; readonly body: string } | null => {
  const s = value as { name?: unknown; body?: unknown };
  if (typeof s?.name !== 'string' || typeof s.body !== 'string') return null;
  return { name: s.name, body: s.body };
};

type TypeShape = { readonly name: string; readonly shape: string; readonly importPath?: string };

const toTypeShape = (entry: unknown): TypeShape | null => {
  const e = entry as { name?: unknown; shape?: unknown; importPath?: unknown };
  if (typeof e?.name !== 'string' || typeof e.shape !== 'string') return null;
  if (e.name.length === 0 || e.shape.length === 0) return null;
  const importPath =
    typeof e.importPath === 'string' && e.importPath.length > 0 ? e.importPath : undefined;
  return importPath !== undefined ? { name: e.name, shape: e.shape, importPath } : { name: e.name, shape: e.shape };
};

export const extractTaskStatement = (navJson: unknown): string => {
  const v = (navJson as { taskStatement?: unknown })?.taskStatement;
  return typeof v === 'string' ? v : '';
};

const toExcerptText = (entry: unknown): string | null => {
  const e = entry as { text?: unknown };
  if (typeof e?.text !== 'string') return null;
  const trimmed = e.text.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const extractSpecExcerpts = (navJson: unknown): readonly string[] => {
  const excerpts = (navJson as { specExcerpts?: unknown })?.specExcerpts;
  if (!Array.isArray(excerpts)) return [];
  return excerpts.map(toExcerptText).filter((t): t is string => t !== null);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const toRequirementDetail = (entry: unknown): string | null => {
  const e = entry as {
    align?: unknown;
    outcome?: unknown;
    acceptance?: { positive?: unknown; negative?: unknown };
  };
  const lines = [
    typeof e?.align === 'string' ? `Requirement: ${e.align}` : null,
    typeof e?.outcome === 'string' ? `Outcome: ${e.outcome}` : null,
    typeof e?.acceptance?.positive === 'string' ? `Accept(+): ${e.acceptance.positive}` : null,
    typeof e?.acceptance?.negative === 'string' ? `Accept(-): ${e.acceptance.negative}` : null,
  ].filter((l): l is string => l !== null);
  return lines.length > 0 ? lines.join('\n') : null;
};

export const extractRequirementDetails = (navJson: unknown): readonly string[] => {
  const reqs = (navJson as { requirements?: unknown })?.requirements;
  if (!Array.isArray(reqs)) return [];
  return reqs.map(toRequirementDetail).filter((d): d is string => d !== null);
};

export const extractPlanRows = (navJson: unknown): readonly string[] => {
  const ctx = (navJson as { planContext?: readonly { row?: unknown }[] })?.planContext ?? [];
  if (!Array.isArray(ctx)) return [];
  const rows = ctx.map(c => (c as { row?: unknown }).row).filter(isNonEmptyString);
  return [...new Set(rows)];
};

export const extractCollaborators = (navJson: unknown): Collaborators => {
  const raw = (navJson as { collaborators?: unknown })?.collaborators;
  if (raw === null || typeof raw !== 'object')
    return { signatures: [], siblingBody: null, typeShapes: [] };
  const c = raw as { signatures?: unknown; siblingBody?: unknown; typeShapes?: unknown };
  const signatures = Array.isArray(c.signatures)
    ? c.signatures.map(toCollaboratorSignature).filter((s): s is CollaboratorSignature => s !== null)
    : [];
  const siblingBody = c.siblingBody !== undefined ? toSiblingBody(c.siblingBody) : null;
  const typeShapes = Array.isArray(c.typeShapes)
    ? c.typeShapes
        .map(toTypeShape)
        .filter((t): t is TypeShape => t !== null)
    : [];
  return { signatures, siblingBody, typeShapes };
};

export const readNavBundle = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const toTaskSpec = (
  input: RunTaskInput,
  targetFiles: readonly string[],
  existingTests: readonly ExistingTest[],
  collaborators: Collaborators,
  taskStatement: string,
  specExcerpts: readonly string[],
  requirementDetails: readonly string[],
  planRows: readonly string[]
): TaskSpec => ({
  agentType: input.agentType,
  navBundlePath: input.navBundle,
  targetFiles,
  existingTests,
  collaborators,
  taskStatement,
  specExcerpts,
  requirementDetails,
  planRows,
});

export async function runTask(
  input: RunTaskInput,
  progress: Progress = createProgress(false)
): Promise<AgentRunResult> {
  applyOverride(input);
  progress.event('task', `${input.agentType} ${input.mode} ${basename(input.navBundle)}`);
  const navJson: unknown = await readNavBundle(input.navBundle);
  const targetFiles = extractTargetFiles(navJson);
  // Guard #4 — empty-spec hard-stop: a null bundle (read/parse failed) or a bundle
  // scoping zero target files means a blind run that would corrupt the tree.
  // Surface it with a distinct failureClass instead of entering runAgentLoop.
  if (navJson === null || targetFiles.length === 0) {
    progress.event('empty-spec', basename(input.navBundle));
    return emptySpecResult(input.agentType, targetFiles);
  }
  const spec: TaskSpec = toTaskSpec(
    input,
    targetFiles,
    extractExistingTests(navJson),
    extractCollaborators(navJson),
    extractTaskStatement(navJson),
    extractSpecExcerpts(navJson),
    extractRequirementDetails(navJson),
    extractPlanRows(navJson)
  );
  return runAgentLoop(spec, {
    profileName: input.profileName,
    mode: input.mode,
    progress,
    connector: { createModel, generate, resolveOllamaNumCtx },
    projectRules,
  });
}
