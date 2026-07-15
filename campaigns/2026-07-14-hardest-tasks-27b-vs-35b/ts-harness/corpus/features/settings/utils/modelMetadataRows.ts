import { formatContextLength, formatPricing, getNonTextModalities } from '@/lib/model-format';

import type { ModelMetadataRow } from '../components/ModelMetadataPopover';
import type { ModelViewModel } from '../types';

export interface ModelMetadataRowLabels {
  readonly context: string;
  readonly pricing: string;
  readonly modalities: string;
  readonly thinking: string;
  readonly thinkingValue: string;
}

export function buildModelMetadataRows(
  model: ModelViewModel,
  labels: ModelMetadataRowLabels
): readonly ModelMetadataRow[] {
  const contextValue = formatContextLength(model.contextLength);
  const pricingValue = formatPricing(model.pricing);
  const modalities = getNonTextModalities(model);

  const candidates: readonly (ModelMetadataRow | null)[] = [
    contextValue ? { label: labels.context, value: contextValue } : null,
    pricingValue ? { label: labels.pricing, value: pricingValue } : null,
    modalities.length > 0 ? { label: labels.modalities, value: modalities.join(', ') } : null,
    model.supportsThinking ? { label: labels.thinking, value: labels.thinkingValue } : null,
  ];

  return candidates.filter((row): row is ModelMetadataRow => row !== null);
}
