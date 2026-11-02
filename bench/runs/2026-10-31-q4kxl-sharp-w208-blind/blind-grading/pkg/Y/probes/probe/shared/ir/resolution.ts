export interface GoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface NonGoalEntry { readonly id: string; readonly text: string; readonly source: string }
export interface ResolutionIr {
  readonly schemaVersion: number;
  readonly shape: string;
  readonly mapping: readonly { readonly noun: string; readonly surfaceId: string | null; readonly kind: string; readonly path: string | null; readonly evidence: string }[];
  readonly drift: readonly { readonly id: string; readonly snapshotSays: string; readonly codeSays: string; readonly status: string; readonly notes: string | null }[];
  readonly blastRadius: readonly string[];
  readonly generatedAt: string;
  readonly branch: string;
}
