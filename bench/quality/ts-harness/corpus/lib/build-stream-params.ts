import { getNonDefaultParams, type ModelParams } from './model-params';
import { buildThinkingOptions } from './thinking-options';

// Subset of provider-bound params, shared by Chat + Lab. All optional: omitted
// when equal to default (mirrors getNonDefaultParams) so providers keep their own defaults.
export interface StreamParamSubset {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly contextSize?: number;
  readonly thinkingEnabled?: boolean;
  readonly thinkingBudget?: number;
}

// providerId is required because thinking budget gating is provider-specific.
export function buildStreamParams(
  providerId: string,
  modelParams: ModelParams | undefined
): StreamParamSubset {
  if (modelParams === undefined) {
    return {};
  }
  const {
    thinkingEnabled: _enabled,
    thinkingBudget,
    ...nonDefault
  } = getNonDefaultParams(modelParams);
  const thinking = buildThinkingOptions(providerId, modelParams.thinkingEnabled, thinkingBudget);
  return { ...nonDefault, ...thinking };
}
