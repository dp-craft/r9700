// PROBE-ONLY stub — types copied from tools/shared/ir/resolution.ts:171-177 (real shapes)
export type GoalEntry = Readonly<{ readonly id: string; readonly text: string; readonly source: string }>;
export type NonGoalEntry = Readonly<{ readonly id: string; readonly text: string; readonly source: string }>;
export type GoalsDoc = Readonly<{
  readonly schemaVersion: 1;
  readonly goals: readonly GoalEntry[];
  readonly nonGoals: readonly NonGoalEntry[];
}>;
export type ResolutionDoc = Readonly<{
  readonly schemaVersion: 1;
  readonly shape: 'feature' | 'modification' | 'bug' | 'refactor';
  readonly mapping: readonly {
    readonly noun: string;
    readonly surfaceId: string | null;
    readonly kind: 'feature' | 'module' | 'entry-point' | 'unknown';
    readonly path: string | null;
    readonly evidence: string;
  }[];
  readonly drift: readonly {
    readonly id: string;
    readonly snapshotSays: string;
    readonly codeSays: string;
    readonly status: 'matches' | 'drift' | 'bug' | 'unclear' | 'new' | 'broken';
    readonly notes: string | null;
  }[];
  readonly blastRadius: readonly string[];
}>;
export type ResolutionIr = ResolutionDoc & Readonly<{
  readonly generatedAt: string;
  readonly branch: string;
}>;
