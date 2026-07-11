export type Bar = 'faithfulTest' | 'correctImpl' | 'gateClean' | 'reviewable';

export type Verdict = 'pass' | 'fail' | 'na';

export interface BarVerdict {
  readonly bar: Bar;
  readonly verdict: Verdict;
  readonly evidence: string;
}

export type PrimaryGap =
  | 'parse-error'
  | 'vacuous-test'
  | 'wrong-test-assertion'
  | 'impl-incomplete'
  | 'impl-wrong-logic'
  | 'gate-fp-style'
  | 'gate-complexity'
  | 'gate-tsc'
  | 'edit-anchor-failure'
  | 'off-task'
  | 'none';

export type FixDistance = 'trivial' | 'moderate' | 'hard';

export interface RunnerGrade {
  readonly runId: string;
  readonly modelId: string;
  readonly furthestStage: string;
  readonly bars: readonly BarVerdict[];
  readonly primaryGap: PrimaryGap;
  readonly fixDistance: FixDistance;
  readonly mergeable: boolean;
  readonly notes: string;
}

export interface PacketFile {
  readonly basename: string;
  readonly content: string;
}

export interface AttemptPacket {
  readonly attempt: number;
  readonly furthestStage: string;
  readonly failedStage: string;
  readonly gateName: string;
  readonly toolCalls: number;
  readonly gateOutput: string;
  readonly files: readonly PacketFile[];
}

export interface ReviewPacket {
  readonly runId: string;
  readonly modelId: string;
  readonly mode: string;
  readonly status: string;
  readonly attempts: readonly AttemptPacket[];
}

export interface CapabilityStats {
  readonly total: number;
  readonly byFurthestStage: Readonly<Record<string, number>>;
  readonly byPrimaryGap: Readonly<Record<string, number>>;
  readonly byModel: Readonly<Record<string, number>>;
  readonly mergeableCount: number;
  readonly mergeableRate: number;
  readonly falseGreenRiskCount: number;
}
