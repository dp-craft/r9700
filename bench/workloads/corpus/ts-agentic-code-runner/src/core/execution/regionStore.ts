// Per-attempt, server-side record of the authorized edit slice for each target
// file. The preload records the sliced region; the submit_region tool reads it
// back to splice model-supplied replacement text over the exact line range —
// no model-provided line numbers, no anchors.

export interface Region {
  readonly startLine: number;
  readonly endLine: number;
}

export interface RegionStore {
  readonly record: (path: string, region: Region) => void;
  readonly get: (path: string) => Region | null;
  readonly clear: (path: string) => void;
}

export function createRegionStore(): RegionStore {
  const regions = new Map<string, Region>();
  const record = (path: string, region: Region): void => {
    regions.set(path, region);
  };
  const get = (path: string): Region | null => regions.get(path) ?? null;
  const clear = (path: string): void => {
    regions.delete(path);
  };
  return { record, get, clear };
}
