import type { Model } from './types';

const CHAT_INCOMPATIBLE_PATTERNS: readonly RegExp[] = [
  /^text-embedding-/i,
  /^dall-e-/i,
  /^tts-/i,
  /^whisper-/i,
  /^text-moderation-/i,
  /^omni-moderation-/i,
  /^davinci-/i,
  /^babbage-/i,
  /^chatgpt-4o-latest$/i,
  /^codex-/i,
  /-transcribe/i,
  /-realtime/i,
  /^gpt-4o-mini-tts/i,
  /^gpt-4o-audio-preview/i,
  /^gpt-4o-mini-audio-preview/i,
  /^pplx-embed-/i,
  /\bgemma\b/i,
  /\btts\b/i,
  /\bembedding\b/i,
  /\bwhisper\b/i,
  /\bmoderation\b/i,
];

export function filterChatModels(models: readonly Model[]): readonly Model[] {
  return models.filter(
    model => !CHAT_INCOMPATIBLE_PATTERNS.some(pattern => pattern.test(model.id))
  );
}

const compareNames = (a: Model, b: Model): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

const comparePriced = (a: Model, b: Model): number => {
  const priceA = a.pricing?.promptPrice ?? 0;
  const priceB = b.pricing?.promptPrice ?? 0;
  const aIsVaries = priceA < 0;
  const bIsVaries = priceB < 0;

  if (aIsVaries && !bIsVaries) return 1;
  if (!aIsVaries && bIsVaries) return -1;
  if (priceA !== priceB) return priceA - priceB;
  return compareNames(a, b);
};

function getProviderPrefix(model: Model): string {
  const slashIndex = model.id.indexOf('/');
  return slashIndex > 0 ? model.id.slice(0, slashIndex).toLowerCase() : '';
}

export function sortModels(models: readonly Model[]): readonly Model[] {
  const groups = new Map<string, Model[]>();
  for (const model of models) {
    const prefix = getProviderPrefix(model);
    const group = groups.get(prefix);
    if (group) {
      group.push(model);
    } else {
      groups.set(prefix, [model]);
    }
  }

  const sortedPrefixes = [...groups.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );

  return sortedPrefixes.flatMap(prefix => {
    const group = groups.get(prefix) ?? [];
    const withPricing = group.filter(m => m.pricing !== undefined);
    const withoutPricing = group.filter(m => m.pricing === undefined);
    return [...withPricing.sort(comparePriced), ...withoutPricing.sort(compareNames)];
  });
}
