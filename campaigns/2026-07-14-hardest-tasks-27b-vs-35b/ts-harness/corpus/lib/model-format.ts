interface PricingInfo {
  readonly promptPrice: number;
  readonly completionPrice: number;
}

interface ModelInfo {
  readonly description?: string;
  readonly contextLength?: number;
  readonly inputModalities?: readonly string[];
}

const MILLION = 1_000_000;
const THOUSAND = 1_000;

export function formatContextLength(contextLength: number | undefined): string | null {
  if (contextLength === undefined || contextLength <= 0) {
    return null;
  }
  if (contextLength >= MILLION) {
    return `${Math.round(contextLength / MILLION)}M`;
  }
  if (contextLength >= THOUSAND) {
    return `${Math.round(contextLength / THOUSAND)}K`;
  }
  return null;
}

const PRICING_PRECISION = 6;

export function formatPricingValue(value: number): string {
  const rounded = Number.parseFloat(value.toFixed(PRICING_PRECISION));
  return `$${rounded}`;
}

export function formatPricing(pricing: PricingInfo | undefined): string | null {
  if (pricing === undefined) {
    return null;
  }
  if (pricing.promptPrice === 0 && pricing.completionPrice === 0) {
    return 'free';
  }
  if (pricing.promptPrice < 0) {
    return 'varies';
  }
  return `${formatPricingValue(pricing.promptPrice)} in / ${formatPricingValue(pricing.completionPrice)} out per 1M`;
}

export function getNonTextModalities(model: ModelInfo): readonly string[] {
  if (!model.inputModalities) {
    return [];
  }
  return model.inputModalities.filter(m => m !== 'text');
}

export function hasMetadata(model: ModelInfo): boolean {
  if (model.description) {
    return true;
  }
  if (model.contextLength !== undefined && model.contextLength > 0) {
    return true;
  }
  return getNonTextModalities(model).length > 0;
}
