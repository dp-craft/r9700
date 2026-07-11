import { createModel, generate, resolveOllamaNumCtx } from '../../llm/connector';
import { projectRules } from '../../rules/rulesProjection';

export const makeTestDeps = () => ({
  connector: { createModel, generate, resolveOllamaNumCtx },
  projectRules,
});
