// PROBE-ONLY: stub for 'spec-pipeline/protocol' — the real file is created by W2-01 (post-HEAD,
// not yet done). PausePayload copied verbatim from tools/spec-pipeline/src/driver/pause.ts:15-40 at HEAD.
type GateDropReason = 'unregistered' | 'capability-unmet';
interface GateDrop {
  readonly gateId: string;
  readonly reason: GateDropReason;
  readonly missingCapabilities: readonly string[];
}
type StepType = 'script' | 'llm' | 'human' | 'loop';
export interface PausePayload {
  readonly runId: string;
  readonly runFingerprint: string;
  readonly epochId: string | undefined;
  readonly stepId: string;
  readonly stepType: StepType;
  readonly role: string | undefined;
  readonly modelProfile: string | undefined;
  readonly outputSchemaRef: string | undefined;
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: readonly string[];
  readonly critics: readonly string[] | undefined;
  readonly reviser: string | undefined;
  readonly maxRounds: number | undefined;
  readonly gatesEachRound: readonly string[] | undefined;
  readonly droppedGates: readonly GateDrop[] | undefined;
  readonly validationErrors?: readonly string[];
  readonly repairFindings?: string;
}
