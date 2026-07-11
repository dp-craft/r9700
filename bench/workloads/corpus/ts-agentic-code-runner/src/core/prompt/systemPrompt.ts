import { type TaskSpec } from '../execution';
import type { AgentType } from '../shared';
import {
  buildCollaboratorsBlock,
  buildExistingTestsBlock,
  buildPlanRowsBlock,
  buildRequirementDetailsBlock,
  buildSpecExcerptsBlock
} from './navBlocks';

const SYSTEM_PREAMBLE =
  'You are an expert TypeScript engineer. Follow EVERY rule below exactly. Automated gates check your output — decomposition, no loops, types, and tests all FAIL the run on any violation and send your code back to fix. Write small, pure, self-explanatory functions that need no comments. Any generic read/edit/verify workflow guidance applies only when the task kickoff below declares no different contract — when it does, the kickoff is authoritative.';

export const buildSystemPrompt = (
  spec: TaskSpec,
  role: AgentType,
  condensedRules: string,
  extraDirective = ''
): string =>
  `${SYSTEM_PREAMBLE}\n\n` +
  `Agent ${role}. Nav bundle: ${spec.navBundlePath}. ` +
  `Targets: ${spec.targetFiles.join(', ')}.` +
  `${buildExistingTestsBlock(spec.existingTests ?? [])}${buildCollaboratorsBlock(spec.collaborators)}` +
  `${buildSpecExcerptsBlock(spec.specExcerpts)}` +
  `${buildRequirementDetailsBlock(spec.requirementDetails)}` +
  `${buildPlanRowsBlock(spec.planRows)}` +
  `\n\nRules:\n${condensedRules}` +
  extraDirective;
