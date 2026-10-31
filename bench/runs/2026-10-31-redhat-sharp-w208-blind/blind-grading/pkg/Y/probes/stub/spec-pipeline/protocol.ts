export interface PausePayload {
  readonly runId: string;
  readonly runFingerprint: string;
  readonly epochId: string | undefined;
  readonly stepId: string;
  readonly stepType: string;
  readonly role: string | undefined;
  readonly modelProfile: string | undefined;
  readonly outputSchemaRef: string | undefined;
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: readonly string[];
  readonly critics: readonly string[] | undefined;
  readonly reviser: string | undefined;
  readonly maxRounds: number | undefined;
  readonly gatesEachRound: readonly string[] | undefined;
  readonly droppedGates: readonly string[] | undefined;
}
