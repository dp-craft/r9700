import type { ModelEntry, PromptEntry } from '../types';
import {
  axisLabel,
  type AxisLabelMap,
  FIRST_AXIS_ID,
  MODEL_AXIS_PREFIX,
  SYSTEM_AXIS_PREFIX
} from './axisLabel';

export type { AxisLabelMap } from './axisLabel';
export { axisLabel, MODEL_AXIS_PREFIX, SYSTEM_AXIS_PREFIX } from './axisLabel';

type AxisEntry = {
  readonly id: string;
  readonly axisId?: number;
};

export function nextAxisId(entries: readonly AxisEntry[]): number {
  const ids = entries
    .map(entry => entry.axisId)
    .filter((axisId): axisId is number => axisId !== undefined);
  return ids.length === 0 ? FIRST_AXIS_ID : Math.max(...ids) + 1;
}

function buildAxisLabelMap(entries: readonly AxisEntry[], prefix: string): AxisLabelMap {
  return entries.reduce<Record<string, string>>((acc, entry, index) => {
    const axisId = entry.axisId ?? index + FIRST_AXIS_ID;
    acc[entry.id] = axisLabel(prefix, axisId);
    return acc;
  }, {});
}

export function modelAxisMap(models: readonly ModelEntry[]): AxisLabelMap {
  return buildAxisLabelMap(models, MODEL_AXIS_PREFIX);
}

export function promptAxisMap(prompts: readonly PromptEntry[]): AxisLabelMap {
  return buildAxisLabelMap(prompts, SYSTEM_AXIS_PREFIX);
}
