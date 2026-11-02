// PROBE-ONLY stub — PausePayload copied verbatim from tools/spec-pipeline/src/driver/pause.ts:15-40
type StepType = 'script' | 'llm' | 'human' | 'loop'; // manifest.ts:19
type GateDrop = {
  readonly gateId: string;
  readonly reason: 'unregistered' | 'capability-unmet';
  readonly missingCapabilities: readonly string[];
}; // driver/capability.ts:15-18

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
