// PROBE-ONLY stub: the real inferred types of tools/shared/ir/resolution.ts at de110510
// (GoalEntrySchema:14, NonGoalEntrySchema:18, MappingEntrySchema:93, DriftEntrySchema:103,
// GoalsDocSchema:41, ResolutionIrSchema:151, types:171-177). Mirrors the inferred shapes;
// the z refinements (unique ids, grain, notes) are not type-level and do not affect the probes.
export interface GoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface NonGoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface MappingEntry {
  readonly noun: string;
  readonly surfaceId: string | null;
  readonly kind: 'feature' | 'module' | 'entry-point' | 'unknown';
  readonly path: string | null;
  readonly evidence: string;
}
export interface DriftEntry {
  readonly id: string;
  readonly snapshotSays: string;
  readonly codeSays: string;
  readonly status: 'matches' | 'drift' | 'bug' | 'unclear' | 'new' | 'broken';
  readonly notes: string | null;
}
export interface GoalsDoc {
  readonly schemaVersion: 1;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
}
export interface ResolutionIr {
  readonly schemaVersion: 1;
  readonly shape: 'feature' | 'modification' | 'bug' | 'refactor';
  readonly mapping: readonly MappingEntry[];
  readonly drift: readonly DriftEntry[];
  readonly blastRadius: readonly string[];
  readonly generatedAt: string;
  readonly branch: string;
}
