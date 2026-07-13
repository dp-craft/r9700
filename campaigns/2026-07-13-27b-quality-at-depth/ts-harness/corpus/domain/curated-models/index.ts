import modelsData from './models.json';
import type { CuratedModel } from './types';

export type { CuratedMatch, CuratedModel } from './types';

const CURATED_MODELS: readonly CuratedModel[] = modelsData as readonly CuratedModel[];

export function getAllCuratedModels(): readonly CuratedModel[] {
  return CURATED_MODELS;
}

export function matchCuratedModel(providerModelId: string): CuratedModel | undefined {
  const lowered = providerModelId.toLowerCase();
  return CURATED_MODELS.find(m => lowered.includes(m.baseName));
}

function parseSize(approxSize: string): number {
  const match = approxSize.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

export function sortModelsWithCurated<T extends { readonly id: string }>(
  models: readonly T[]
): readonly T[] {
  const curated: T[] = [];
  const nonCurated: T[] = [];

  models.forEach(model => {
    const match = matchCuratedModel(model.id);
    if (match) {
      curated.push(model);
    } else {
      nonCurated.push(model);
    }
  });

  const sortedCurated = [...curated].sort((a, b) => {
    const matchA = matchCuratedModel(a.id);
    const matchB = matchCuratedModel(b.id);
    const sizeA = matchA ? parseSize(matchA.approxSize) : 0;
    const sizeB = matchB ? parseSize(matchB.approxSize) : 0;
    if (sizeA !== sizeB) return sizeA - sizeB;
    return a.id.localeCompare(b.id);
  });

  return [...sortedCurated, ...nonCurated];
}
