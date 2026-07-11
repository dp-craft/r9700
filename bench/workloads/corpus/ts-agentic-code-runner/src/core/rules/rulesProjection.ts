import { resolve } from 'node:path';

import { ENV_RULES_PATH_KEY } from '../profiles';
import type { AgentType } from '../shared';
import { loadMarkdownWithImports, stripFrontmatter } from './rulesLoader';

export interface RulesProjection {
  readonly agentType: AgentType;
  readonly condensedRules: string;
}

const FRAGMENT_ROOT_REL = 'claude-artifacts/agentic-runner-rules';

const ROLE_FILES: Readonly<Record<AgentType, string>> = {
  'code-logic-writer': 'roles/code-logic-writer.md',
  'ts-test-writer': 'roles/ts-test-writer.md',
  'lint-fix-loop': 'roles/lint-fix-loop.md',
  'ui-writer': 'roles/ui-writer.md',
};

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const BLANK_RUN_RE = /\n{3,}/g;

const fragmentRoot = (): string => resolve(process.cwd(), FRAGMENT_ROOT_REL);

// Role files compose atoms via Claude-Code `@`-imports (rulesLoader), resolved against the
// fragment root; HTML comments (LLM-PRIMARY headers, notes) are stripped from the model surface.
const composeRole = async (agentType: AgentType): Promise<string> => {
  const root = fragmentRoot();
  const roleAbs = resolve(root, ROLE_FILES[agentType]);
  const expanded = await loadMarkdownWithImports(roleAbs, { root });
  const clean = expanded.replace(HTML_COMMENT_RE, '');
  return [`# Agent: ${agentType}`, clean].join('\n\n').replace(BLANK_RUN_RE, '\n\n').trimEnd();
};

const resolveCondensedRules = async (agentType: AgentType): Promise<string> => {
  const rulesPath = process.env[ENV_RULES_PATH_KEY];
  if (typeof rulesPath === 'string' && rulesPath.length > 0) {
    return stripFrontmatter(await loadMarkdownWithImports(rulesPath, { root: process.cwd() }));
  }
  return composeRole(agentType);
};

export async function projectRules(agentType: AgentType): Promise<RulesProjection> {
  return { agentType, condensedRules: await resolveCondensedRules(agentType) };
}

// Injected rules-projection service boundary (consumed by the runner controller
// via RunnerDeps). Typed by `typeof` so the signature stays identical.
export type ProjectRulesFn = typeof projectRules;
