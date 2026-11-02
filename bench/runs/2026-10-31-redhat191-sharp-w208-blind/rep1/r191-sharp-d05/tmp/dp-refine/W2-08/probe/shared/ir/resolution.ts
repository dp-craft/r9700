// PROBE-ONLY stub: mirrors tools/shared/ir/resolution.ts exports the brief imports.
export interface GoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface NonGoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface GoalsDoc { readonly schemaVersion: number; readonly goals: readonly GoalEntry[]; readonly nonGoals: readonly NonGoalEntry[] }
export interface MappingEntry { readonly noun: string; readonly surfaceId: string | null; readonly kind: string; readonly path: string | null; readonly evidence: string }
export interface DriftEntry { readonly id: string; readonly snapshotSays: string; readonly codeSays: string; readonly status: string; readonly notes: string | null }
export interface ResolutionDoc { readonly schemaVersion: number; readonly shape: string; readonly mapping: readonly MappingEntry[]; readonly drift: readonly DriftEntry[]; readonly blastRadius: readonly string[] }
export type ResolutionIr = ResolutionDoc & { readonly generatedAt: string; readonly branch: string };
