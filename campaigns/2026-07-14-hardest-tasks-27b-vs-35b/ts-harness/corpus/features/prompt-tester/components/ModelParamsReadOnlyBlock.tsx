import { DEFAULT_MODEL_PARAMS } from '@/lib/model-params';

import type {
  ModelParamsReadOnlyBlockProps,
  ModelParamsReadOnlyLabels,
  SliderValues
} from '../types';
import type { ModelParamRowVM } from './ModelParamsList';
import { ModelParamsList } from './ModelParamsList';

export type { ModelParamsReadOnlyBlockProps, ModelParamsReadOnlyLabels };

const SLIDER_DEFAULTS = {
  min: 0,
  max: 1,
  step: 0.01,
} as const;

const toRows = (
  params: SliderValues,
  labels: ModelParamsReadOnlyLabels
): readonly ModelParamRowVM[] => [
  { key: 'temp', label: labels.temp, value: params.temp, ...SLIDER_DEFAULTS },
  { key: 'topP', label: labels.topP, value: params.topP, ...SLIDER_DEFAULTS },
  {
    key: 'maxTok',
    label: labels.maxTok,
    value: params.maxTok,
    min: 1,
    max: 128000,
    step: 1,
  },
  { key: 'freq', label: labels.freq, value: params.freq, ...SLIDER_DEFAULTS },
  { key: 'pres', label: labels.pres, value: params.pres, ...SLIDER_DEFAULTS },
  {
    key: 'contextSize',
    label: labels.contextSize,
    value: params.contextSize ?? DEFAULT_MODEL_PARAMS.contextSize,
    min: 512,
    max: 200000,
    step: 512,
  },
];

export const ModelParamsReadOnlyBlock = ({
  params,
  supportsThinking,
  thinking,
  thinkingBudget,
  labels,
  className,
}: ModelParamsReadOnlyBlockProps): React.ReactElement => (
  <ModelParamsList
    rows={toRows(params, labels)}
    editable={false}
    supportsThinking={supportsThinking}
    thinking={thinking}
    thinkingBudget={thinkingBudget}
    thinkingLabel={labels.thinking}
    thinkingBudgetLabel={labels.thinkingBudget}
    className={className}
  />
);
