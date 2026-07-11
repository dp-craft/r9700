import Database from 'better-sqlite3';

import type { AgentRunResult, AttemptRecord } from '../shared';

export interface TelemetryStore {
  readonly recordRun: (run: TaskRunRow) => void;
  readonly recordAttempt: (row: AttemptRunRow) => void;
  readonly close: () => void;
}

export interface TaskRunRow {
  readonly trace_id: string; // OTel-named columns
  readonly span_id: string;
  readonly agent_type: string;
  readonly status: string;
  readonly final_rung: string;
  readonly backend: string; // actual backend that ran ('unknown' when no model ran)
  readonly model_id: string; // actual model id that ran ('unknown' when no model ran)
  readonly failure_class: string; // why it failed ('' when completed)
  readonly attempts: number;
  readonly duration_ms: number;
  readonly red_observed: number; // 0/1
  readonly green_observed: number; // 0/1
  readonly escalated: number; // 0/1
  readonly fallback_sanctioned: number; // 0/1
  readonly touched_file_count: number;
  readonly target_file_count: number; // targets the run was scoped to (0 ⇒ empty footprint)
  readonly failed_stage: string; // pipeline stage that failed ('' when none failed)
  readonly started_at: string; // ISO
  readonly input_tokens: number; // prompt tokens summed across all drives (0 when no model ran)
  readonly output_tokens: number; // completion tokens summed across all drives
  readonly total_tokens: number; // total tokens summed across all drives
}

export interface AttemptRunRow {
  readonly trace_id: string;
  readonly attempt: number;
  readonly rung: string;
  readonly model_id: string;
  readonly backend: string;
  readonly stage: string;
  readonly tool_calls: number;
  readonly status: string;
  readonly duration_ms: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
}

export interface RunMeta {
  readonly traceId: string;
  readonly spanId: string;
  readonly durationMs: number;
  readonly startedAt: string;
}

const CREATE_ATTEMPT_TABLE = `CREATE TABLE IF NOT EXISTS attempt_runs(trace_id TEXT, attempt INTEGER, rung TEXT, model_id TEXT, backend TEXT, stage TEXT, tool_calls INTEGER, status TEXT, duration_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER)`;

const INSERT_ATTEMPT = `INSERT INTO attempt_runs(trace_id, attempt, rung, model_id, backend, stage, tool_calls, status, duration_ms, input_tokens, output_tokens, total_tokens) VALUES (@trace_id, @attempt, @rung, @model_id, @backend, @stage, @tool_calls, @status, @duration_ms, @input_tokens, @output_tokens, @total_tokens)`;

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS task_runs(trace_id TEXT, span_id TEXT, agent_type TEXT, status TEXT, final_rung TEXT, backend TEXT, model_id TEXT, failure_class TEXT, attempts INTEGER, duration_ms INTEGER, red_observed INTEGER, green_observed INTEGER, escalated INTEGER, fallback_sanctioned INTEGER, touched_file_count INTEGER, target_file_count INTEGER, failed_stage TEXT, started_at TEXT, input_tokens INTEGER, output_tokens INTEGER, total_tokens INTEGER)`;

const INSERT_RUN = `INSERT INTO task_runs(trace_id, span_id, agent_type, status, final_rung, backend, model_id, failure_class, attempts, duration_ms, red_observed, green_observed, escalated, fallback_sanctioned, touched_file_count, target_file_count, failed_stage, started_at, input_tokens, output_tokens, total_tokens) VALUES (@trace_id, @span_id, @agent_type, @status, @final_rung, @backend, @model_id, @failure_class, @attempts, @duration_ms, @red_observed, @green_observed, @escalated, @fallback_sanctioned, @touched_file_count, @target_file_count, @failed_stage, @started_at, @input_tokens, @output_tokens, @total_tokens)`;

const UNKNOWN_BACKEND = 'unknown';
const toBit = (value: boolean): number => (value ? 1 : 0);

export function toTaskRunRow(result: AgentRunResult, meta: RunMeta): TaskRunRow {
  return {
    trace_id: meta.traceId,
    span_id: meta.spanId,
    agent_type: result.agentType,
    status: result.status,
    final_rung: result.finalRung,
    backend: result.backend ?? UNKNOWN_BACKEND,
    model_id: result.modelId,
    failure_class: result.failureClass ?? '',
    attempts: result.attempts,
    duration_ms: meta.durationMs,
    red_observed: toBit(result.redObserved),
    green_observed: toBit(result.greenObserved),
    escalated: toBit(result.escalated),
    fallback_sanctioned: toBit(result.fallbackSanctioned),
    touched_file_count: result.touchedFiles.length,
    target_file_count: result.targetFileCount ?? 0,
    failed_stage: result.failedStage ?? '',
    started_at: meta.startedAt,
    input_tokens: result.usage?.inputTokens ?? 0,
    output_tokens: result.usage?.outputTokens ?? 0,
    total_tokens: result.usage?.totalTokens ?? 0,
  };
}

// Columns added after the initial schema. CREATE TABLE IF NOT EXISTS does NOT
// alter a pre-existing table, so each must be back-filled via ALTER TABLE on an
// older db or INSERT_RUN binds a non-existent column and every write throws.
const ADDED_COLUMNS: readonly string[] = [
  'target_file_count INTEGER',
  'failed_stage TEXT',
  'input_tokens INTEGER',
  'output_tokens INTEGER',
  'total_tokens INTEGER',
];

interface ColumnInfo {
  readonly name: string;
}

const migrateSchema = (db: Database.Database): void => {
  const existing = new Set(
    db.prepare('PRAGMA table_info(task_runs)').all().map((c): string => (c as ColumnInfo).name)
  );
  ADDED_COLUMNS.forEach((decl): void => {
    const name = decl.split(' ')[0];
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE task_runs ADD COLUMN ${decl}`);
    }
  });
};

export const toAttemptRunRow = (rec: AttemptRecord, traceId: string): AttemptRunRow => ({
  trace_id: traceId,
  attempt: rec.attempt,
  rung: rec.rung,
  model_id: rec.modelId,
  backend: rec.backend,
  stage: rec.stage,
  tool_calls: rec.toolCalls,
  status: rec.status,
  duration_ms: rec.durationMs,
  input_tokens: rec.usage.inputTokens,
  output_tokens: rec.usage.outputTokens,
  total_tokens: rec.usage.totalTokens,
});

export function openTelemetry(dbPath: string): TelemetryStore {
  const db = new Database(dbPath);
  db.exec(CREATE_TABLE);
  db.exec(CREATE_ATTEMPT_TABLE);
  migrateSchema(db);
  const insert = db.prepare<TaskRunRow>(INSERT_RUN);
  const insertAttempt = db.prepare<AttemptRunRow>(INSERT_ATTEMPT);
  return {
    recordRun: (run: TaskRunRow): void => {
      insert.run(run);
    },
    recordAttempt: (row: AttemptRunRow): void => {
      insertAttempt.run(row);
    },
    close: (): void => {
      db.close();
    },
  };
}
