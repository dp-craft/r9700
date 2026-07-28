export const FIRST_AXIS_ID = 1;
export const MODEL_AXIS_PREFIX = 'M';
export const SYSTEM_AXIS_PREFIX = 'S';

export type AxisLabelMap = Readonly<Record<string, string>>;

export function axisLabel(prefix: string, axisId: number): string {
  return `${prefix}${axisId}`;
}
