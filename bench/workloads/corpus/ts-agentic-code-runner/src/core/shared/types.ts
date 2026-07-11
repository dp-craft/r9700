export type AgentType = 'code-logic-writer' | 'ts-test-writer' | 'lint-fix-loop' | 'ui-writer';
export type RunMode = 'impl' | 'tdd';
export type RungName = 'ollama' | 'openrouter' | 'claude';
// `local-exhausted` is the terminal local-ladder rung: every local rung is spent
// and the task is handed off for orchestrator/human review (NOT a billable Claude
// fallback). Legacy runs/telemetry use the alias `escalate-to-claude` on read.
export type RunStatus = 'completed' | 'failed' | 'local-exhausted';
// Why a run did not complete. `auth`/`connectivity`/`fatal`/`interrupted`/
// `dirty-tree`/`empty-spec`/`context-overflow` are infra/config HARD STOPS
// (fallbackSanctioned=false — fix the cause, do not hand off for review);
// `no-progress`/`idle-stall`/`gate-fail` mean the model genuinely tried and
// orchestrator/human review is sanctioned. `dirty-tree` fires when a target file already
// differs from HEAD at run start — the runner reverts to the pre-run snapshot,
// so a dirty start would persist the corruption. `empty-spec` fires when the nav
// bundle is missing/corrupt or scopes zero target files — a blind run cannot be
// run safely. `context-overflow` fires when an ollama drive's prompt exceeds
// num_ctx (the model silently slides off the task/system prompt) — force-escalate
// to a larger-context rung, never retry on the same model.
export type FailureClass =
  | 'connectivity'
  | 'auth'
  | 'no-progress'
  | 'idle-stall'
  | 'gate-fail'
  | 'fatal'
  | 'dirty-tree'
  | 'empty-spec'
  | 'context-overflow'
  | 'generation-timeout'
  | 'interrupted';
export type BackendKind = 'ollama' | 'openai-compatible' | 'openrouter';
export type ToolName = 'read' | 'write' | 'edit' | 'bash' | 'grep' | 'verify_edit' | 'lsp';

export interface ToolResult {
  readonly ok: boolean;
  readonly output: string;
}

// Token usage for a run, summed across every model drive (red + green + each
// gate-retry attempt across the escalation ladder). The connector reports
// per-call usage; the runner accumulates it so telemetry records the real cost.
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}
export interface AgentRunResult {
  readonly status: RunStatus;
  readonly agentType: AgentType;
  readonly touchedFiles: readonly string[];
  // Last escalation-ladder rung reached. This is the LADDER POSITION, not the
  // backend that ran — read `backend` for the actual provider. With an
  // openrouter-pinned profile this can still read 'ollama' (the ladder start)
  // because no-progress halts before the ladder ever advances.
  readonly finalRung: RungName;
  // Actual backend the FINAL attempt ran on (derived from the resolved profile,
  // NOT the ladder rung). Absent only when no model ran (fatal infra error or
  // external interrupt).
  readonly backend?: BackendKind;
  // Why the run did not complete (absent on a completed run). Drives
  // `fallbackSanctioned` and is the primary failure-mode dimension in telemetry.
  readonly failureClass?: FailureClass;
  // True when the escalation ladder advanced past its first rung.
  readonly escalated: boolean;
  // True when orchestrator/human review is the SANCTIONED next step: the runner
  // failed for a non-connectivity reason (no-progress / gate-fail / idle-stall /
  // ladder-exhaustion). This sanctions a review handoff, NOT billable Claude.
  // False for a connectivity hard-stop (infra — surface it, do NOT hand off for
  // review) and for completed runs. Field name kept for telemetry-column stability.
  readonly fallbackSanctioned: boolean;
  readonly attempts: number;
  readonly redObserved: boolean;
  readonly greenObserved: boolean;
  readonly modelId: string;
  // Number of target files the run was scoped to (0 ⇒ empty footprint).
  readonly targetFileCount?: number;
  // Display name of the pipeline stage that failed (absent when no stage failed).
  readonly failedStage?: string;
  // Token usage summed across every model drive in the run (absent when no model
  // ran — fatal infra / dirty-tree hard stops).
  readonly usage?: TokenUsage;
  // Per-attempt telemetry records (absent when no model ran — fatal/dirty-tree).
  readonly attemptRecords?: readonly AttemptRecord[];
  readonly error?: string;
}

export interface AttemptRecord {
  readonly attempt: number;
  readonly rung: RungName;
  readonly modelId: string;
  readonly backend: BackendKind;
  readonly stage: string;
  readonly toolCalls: number;
  readonly status: string;
  readonly durationMs: number;
  readonly usage: TokenUsage;
}
