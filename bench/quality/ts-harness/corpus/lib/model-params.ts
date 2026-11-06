export interface ModelParams {
  readonly temperature: number;
  readonly maxTokens: number;
  readonly topP: number;
  readonly thinkingEnabled: boolean;
  readonly thinkingBudget: number;
  readonly contextSize: number;
}

export interface ParamRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export interface ParamRanges {
  readonly temperature: ParamRange;
  readonly maxTokens: ParamRange;
  readonly topP: ParamRange;
  readonly thinkingBudget: ParamRange;
  readonly contextSize: ParamRange;
}

const CONTEXT_SIZE_DEFAULT = 4096;
const CONTEXT_SIZE_MIN = 512;
const CONTEXT_SIZE_MAX = 200000;
const CONTEXT_SIZE_STEP = 512;

export const DEFAULT_MODEL_PARAMS: Readonly<ModelParams> = {
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  thinkingEnabled: false,
  thinkingBudget: 10240,
  contextSize: CONTEXT_SIZE_DEFAULT,
} as const;

export const PARAM_RANGES: Readonly<ParamRanges> = {
  temperature: { min: 0, max: 2, step: 0.1, default: 0.7 },
  maxTokens: { min: 1, max: 32768, step: 1, default: 2048 },
  topP: { min: 0, max: 1, step: 0.05, default: 1.0 },
  thinkingBudget: { min: 1024, max: 32768, step: 1024, default: 10240 },
  contextSize: {
    min: CONTEXT_SIZE_MIN,
    max: CONTEXT_SIZE_MAX,
    step: CONTEXT_SIZE_STEP,
    default: CONTEXT_SIZE_DEFAULT,
  },
} as const;

export function clampParam(key: keyof ParamRanges, value: number): number {
  const range = PARAM_RANGES[key];
  if (Number.isNaN(value)) {
    return range.default;
  }
  return Math.min(Math.max(value, range.min), range.max);
}

export function isAtDefaults(params: ModelParams | undefined): boolean {
  if (params === undefined) {
    return true;
  }
  return (
    params.temperature === DEFAULT_MODEL_PARAMS.temperature &&
    params.maxTokens === DEFAULT_MODEL_PARAMS.maxTokens &&
    params.topP === DEFAULT_MODEL_PARAMS.topP &&
    params.thinkingEnabled === DEFAULT_MODEL_PARAMS.thinkingEnabled &&
    params.thinkingBudget === DEFAULT_MODEL_PARAMS.thinkingBudget &&
    params.contextSize === DEFAULT_MODEL_PARAMS.contextSize
  );
}

type NonDefaultResult = Partial<{
  readonly temperature: number;
  readonly maxTokens: number;
  readonly topP: number;
  readonly thinkingEnabled: boolean;
  readonly thinkingBudget: number;
  readonly contextSize: number;
}>;

export function getNonDefaultParams(params: ModelParams | undefined): NonDefaultResult {
  if (params === undefined) {
    return {};
  }
  const result: Record<string, number | boolean> = {};
  if (params.temperature !== DEFAULT_MODEL_PARAMS.temperature) {
    result.temperature = params.temperature;
  }
  if (params.maxTokens !== DEFAULT_MODEL_PARAMS.maxTokens) {
    result.maxTokens = params.maxTokens;
  }
  if (params.topP !== DEFAULT_MODEL_PARAMS.topP) {
    result.topP = params.topP;
  }
  if (params.thinkingEnabled !== DEFAULT_MODEL_PARAMS.thinkingEnabled) {
    result.thinkingEnabled = params.thinkingEnabled;
  }
  if (params.thinkingBudget !== DEFAULT_MODEL_PARAMS.thinkingBudget) {
    result.thinkingBudget = params.thinkingBudget;
  }
  if (params.contextSize !== DEFAULT_MODEL_PARAMS.contextSize) {
    result.contextSize = params.contextSize;
  }
  return result;
}

export function clampAllParams(params: ModelParams): ModelParams {
  return {
    temperature: clampParam('temperature', params.temperature),
    maxTokens: clampParam('maxTokens', params.maxTokens),
    topP: clampParam('topP', params.topP),
    thinkingEnabled: params.thinkingEnabled,
    thinkingBudget: clampParam('thinkingBudget', params.thinkingBudget),
    contextSize: clampParam('contextSize', params.contextSize),
  };
}

export function resolveModelParams(params: ModelParams | undefined): ModelParams {
  if (params === undefined) {
    return DEFAULT_MODEL_PARAMS;
  }
  return params;
}
