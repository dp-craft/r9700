import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentRunResult, AttemptRecord } from '../shared/types';
import { openTelemetry, toAttemptRunRow, toTaskRunRow } from './telemetry';

const makeResult = (overrides: Partial<AgentRunResult> = {}): AgentRunResult => ({
  status: 'completed',
  agentType: 'code-logic-writer',
  touchedFiles: ['a.ts', 'b.ts'],
  finalRung: 'ollama',
  escalated: false,
  fallbackSanctioned: false,
  attempts: 2,
  redObserved: true,
  greenObserved: false,
  modelId: 'qwen2.5-coder:7b',
  ...overrides,
});

const meta = {
  traceId: 'trace-1',
  spanId: 'span-1',
  durationMs: 1234,
  startedAt: '2026-06-17T20:00:00.000Z',
} as const;

describe('telemetry', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acr-telemetry-'));
    dbPath = join(dir, 'telemetry.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('openTelemetry', () => {
    it('should create the task_runs table when opening a fresh db', () => {
      const store = openTelemetry(dbPath);
      store.close();
      const db = new Database(dbPath);
      const row = db
        .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'task_runs\'')
        .get();
      db.close();
      expect(row).toEqual({ name: 'task_runs' });
    });

    it('should be idempotent when re-opening an existing db', () => {
      openTelemetry(dbPath).close();
      expect(() => openTelemetry(dbPath).close()).not.toThrow();
    });
  });

  describe('recordRun', () => {
    it('should insert exactly one row when recording a run', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(toTaskRunRow(makeResult(), meta));
      store.close();
      const db = new Database(dbPath);
      const count = db.prepare('SELECT COUNT(*) AS c FROM task_runs').get() as { c: number };
      db.close();
      expect(count.c).toBe(1);
    });

    it('should persist the OTel-named column values when recording a run', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(toTaskRunRow(makeResult(), meta));
      store.close();
      const db = new Database(dbPath);
      const row = db.prepare('SELECT * FROM task_runs').get();
      db.close();
      expect(row).toEqual({
        trace_id: 'trace-1',
        span_id: 'span-1',
        agent_type: 'code-logic-writer',
        status: 'completed',
        final_rung: 'ollama',
        backend: 'unknown',
        model_id: 'qwen2.5-coder:7b',
        failure_class: '',
        attempts: 2,
        duration_ms: 1234,
        red_observed: 1,
        green_observed: 0,
        escalated: 0,
        fallback_sanctioned: 0,
        touched_file_count: 2,
        target_file_count: 0,
        failed_stage: '',
        started_at: '2026-06-17T20:00:00.000Z',
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      });
    });

    it('should persist backend / model_id / failure_class / escalated / fallback_sanctioned columns', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(
        toTaskRunRow(
          makeResult({
            status: 'failed',
            backend: 'openrouter',
            modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
            failureClass: 'auth',
            escalated: false,
            fallbackSanctioned: false,
          }),
          meta
        )
      );
      store.close();
      const db = new Database(dbPath);
      const row = db
        .prepare(
          'SELECT backend, model_id, failure_class, escalated, fallback_sanctioned FROM task_runs'
        )
        .get();
      db.close();
      expect(row).toEqual({
        backend: 'openrouter',
        model_id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        failure_class: 'auth',
        escalated: 0,
        fallback_sanctioned: 0,
      });
    });

    it('should store an empty failure_class for a completed run', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(toTaskRunRow(makeResult(), meta));
      store.close();
      const db = new Database(dbPath);
      const row = db.prepare('SELECT failure_class FROM task_runs').get();
      db.close();
      expect(row).toEqual({ failure_class: '' });
    });
  });

  describe('toTaskRunRow', () => {
    it('should map agent result fields to OTel-named row fields', () => {
      const row = toTaskRunRow(makeResult({ touchedFiles: ['x.ts'] }), meta);
      expect(row).toEqual({
        trace_id: 'trace-1',
        span_id: 'span-1',
        agent_type: 'code-logic-writer',
        status: 'completed',
        final_rung: 'ollama',
        backend: 'unknown',
        model_id: 'qwen2.5-coder:7b',
        failure_class: '',
        attempts: 2,
        duration_ms: 1234,
        red_observed: 1,
        green_observed: 0,
        escalated: 0,
        fallback_sanctioned: 0,
        touched_file_count: 1,
        target_file_count: 0,
        failed_stage: '',
        started_at: '2026-06-17T20:00:00.000Z',
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
      });
    });

    it('should map redObserved/greenObserved booleans to 0/1 integers', () => {
      const row = toTaskRunRow(makeResult({ redObserved: false, greenObserved: true }), meta);
      expect(row.red_observed).toBe(0);
      expect(row.green_observed).toBe(1);
    });

    it('should map escalated/fallbackSanctioned booleans to 0/1 and default absent backend to "unknown"', () => {
      const row = toTaskRunRow(makeResult({ escalated: true, fallbackSanctioned: true }), meta);
      expect(row.escalated).toBe(1);
      expect(row.fallback_sanctioned).toBe(1);
      expect(row.backend).toBe('unknown');
    });

    it('should map targetFileCount and failedStage when present', () => {
      const row = toTaskRunRow(makeResult({ targetFileCount: 2, failedStage: 'lint' }), meta);
      expect(row.target_file_count).toBe(2);
      expect(row.failed_stage).toBe('lint');
    });

    it('should default target_file_count to 0 and failed_stage to "" when absent', () => {
      const row = toTaskRunRow(makeResult(), meta);
      expect(row.target_file_count).toBe(0);
      expect(row.failed_stage).toBe('');
    });

    it('should map token usage to input/output/total token columns when present', () => {
      const row = toTaskRunRow(
        makeResult({ usage: { inputTokens: 1500, outputTokens: 320, totalTokens: 1820 } }),
        meta
      );
      expect(row.input_tokens).toBe(1500);
      expect(row.output_tokens).toBe(320);
      expect(row.total_tokens).toBe(1820);
    });

    it('should default token columns to 0 when usage is absent (no model ran)', () => {
      const row = toTaskRunRow(makeResult(), meta);
      expect(row.input_tokens).toBe(0);
      expect(row.output_tokens).toBe(0);
      expect(row.total_tokens).toBe(0);
    });
  });

  describe('token-usage round-trip', () => {
    it('should persist and read back input/output/total token columns', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(
        toTaskRunRow(
          makeResult({ usage: { inputTokens: 90000, outputTokens: 450, totalTokens: 90450 } }),
          meta
        )
      );
      store.close();
      const db = new Database(dbPath);
      const row = db
        .prepare('SELECT input_tokens, output_tokens, total_tokens FROM task_runs')
        .get();
      db.close();
      expect(row).toEqual({ input_tokens: 90000, output_tokens: 450, total_tokens: 90450 });
    });
  });

  describe('target_file_count / failed_stage round-trip', () => {
    it('should persist and read back target_file_count and failed_stage', () => {
      const store = openTelemetry(dbPath);
      store.recordRun(
        toTaskRunRow(makeResult({ targetFileCount: 2, failedStage: 'tsc' }), meta)
      );
      store.close();
      const db = new Database(dbPath);
      const row = db.prepare('SELECT target_file_count, failed_stage FROM task_runs').get();
      db.close();
      expect(row).toEqual({ target_file_count: 2, failed_stage: 'tsc' });
    });
  });

  describe('schema migration', () => {
    const OLD_CREATE = `CREATE TABLE task_runs(trace_id TEXT, span_id TEXT, agent_type TEXT, status TEXT, final_rung TEXT, backend TEXT, model_id TEXT, failure_class TEXT, attempts INTEGER, duration_ms INTEGER, red_observed INTEGER, green_observed INTEGER, escalated INTEGER, fallback_sanctioned INTEGER, touched_file_count INTEGER, started_at TEXT)`;
    const OLD_INSERT = `INSERT INTO task_runs(trace_id, span_id, agent_type, status, final_rung, backend, model_id, failure_class, attempts, duration_ms, red_observed, green_observed, escalated, fallback_sanctioned, touched_file_count, started_at) VALUES ('t0','s0','a','completed','ollama','unknown','m','',1,1,0,0,0,0,0,'2026-01-01T00:00:00.000Z')`;

    it('should add the new columns when opening a db with the pre-migration schema', () => {
      const seed = new Database(dbPath);
      seed.exec(OLD_CREATE);
      seed.exec(OLD_INSERT);
      seed.close();

      const store = openTelemetry(dbPath);
      store.recordRun(toTaskRunRow(makeResult({ targetFileCount: 3, failedStage: 'tsc' }), meta));
      store.close();

      const db = new Database(dbPath);
      const row = db
        .prepare('SELECT target_file_count, failed_stage FROM task_runs WHERE trace_id = ?')
        .get('trace-1');
      const count = db.prepare('SELECT COUNT(*) AS c FROM task_runs').get() as { c: number };
      db.close();
      expect(row).toEqual({ target_file_count: 3, failed_stage: 'tsc' });
      expect(count.c).toBe(2);
    });
  });

  it('should not leave the db file open after close', () => {
    const store = openTelemetry(dbPath);
    store.close();
    expect(existsSync(dbPath)).toBe(true);
  });
});

// ─── attempt_runs ────────────────────────────────────────────────────────────

const makeAttemptRecord = (overrides: Partial<AttemptRecord> = {}): AttemptRecord => ({
  attempt: 1,
  rung: 'ollama',
  modelId: 'qwen2.5-coder:7b',
  backend: 'ollama',
  stage: '',
  toolCalls: 5,
  status: 'completed',
  durationMs: 500,
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  ...overrides,
});

describe('toAttemptRunRow', () => {
  it('should map attempt record fields to snake_case row fields', () => {
    const row = toAttemptRunRow(makeAttemptRecord(), 'trace-1');
    expect(row).toEqual({
      trace_id: 'trace-1',
      attempt: 1,
      rung: 'ollama',
      model_id: 'qwen2.5-coder:7b',
      backend: 'ollama',
      stage: '',
      tool_calls: 5,
      status: 'completed',
      duration_ms: 500,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
  });

  it('should split token usage into input/output/total columns', () => {
    const row = toAttemptRunRow(
      makeAttemptRecord({ usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } }),
      'trace-x'
    );
    expect(row.input_tokens).toBe(1000);
    expect(row.output_tokens).toBe(200);
    expect(row.total_tokens).toBe(1200);
  });

  it('should propagate the trace_id argument to the row', () => {
    const row = toAttemptRunRow(makeAttemptRecord(), 'my-trace-id');
    expect(row.trace_id).toBe('my-trace-id');
  });

  it('should map a non-empty stage when a pipeline stage failed', () => {
    const row = toAttemptRunRow(makeAttemptRecord({ stage: 'tsc', status: 'failed' }), 'trace-1');
    expect(row.stage).toBe('tsc');
    expect(row.status).toBe('failed');
  });
});

describe('attempt_runs table', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acr-attempt-'));
    dbPath = join(dir, 'telemetry.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('should create the attempt_runs table when opening a fresh db', () => {
    const store = openTelemetry(dbPath);
    store.close();
    const db = new Database(dbPath);
    const row = db
      .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'attempt_runs\'')
      .get();
    db.close();
    expect(row).toEqual({ name: 'attempt_runs' });
  });

  it('should insert a readable row when recording an attempt', () => {
    const store = openTelemetry(dbPath);
    store.recordAttempt(toAttemptRunRow(makeAttemptRecord(), 'trace-1'));
    store.close();
    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM attempt_runs').get();
    db.close();
    expect(row).toEqual({
      trace_id: 'trace-1',
      attempt: 1,
      rung: 'ollama',
      model_id: 'qwen2.5-coder:7b',
      backend: 'ollama',
      stage: '',
      tool_calls: 5,
      status: 'completed',
      duration_ms: 500,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    });
  });

  it('should insert exactly one row per recordAttempt call', () => {
    const store = openTelemetry(dbPath);
    store.recordAttempt(toAttemptRunRow(makeAttemptRecord({ attempt: 1 }), 'trace-1'));
    store.recordAttempt(toAttemptRunRow(makeAttemptRecord({ attempt: 2 }), 'trace-1'));
    store.close();
    const db = new Database(dbPath);
    const count = db.prepare('SELECT COUNT(*) AS c FROM attempt_runs').get() as { c: number };
    db.close();
    expect(count.c).toBe(2);
  });

  it('should work when opening a db that predates attempt_runs (CREATE IF NOT EXISTS)', () => {
    const OLD_TASK_RUNS = `CREATE TABLE task_runs(trace_id TEXT, span_id TEXT, agent_type TEXT, status TEXT, final_rung TEXT, backend TEXT, model_id TEXT, failure_class TEXT, attempts INTEGER, duration_ms INTEGER, red_observed INTEGER, green_observed INTEGER, escalated INTEGER, fallback_sanctioned INTEGER, touched_file_count INTEGER, started_at TEXT)`;
    const seed = new Database(dbPath);
    seed.exec(OLD_TASK_RUNS);
    seed.close();

    expect((): void => {
      const store = openTelemetry(dbPath);
      store.recordAttempt(toAttemptRunRow(makeAttemptRecord(), 'trace-2'));
      store.close();
    }).not.toThrow();

    const db = new Database(dbPath);
    const count = db.prepare('SELECT COUNT(*) AS c FROM attempt_runs').get() as { c: number };
    db.close();
    expect(count.c).toBe(1);
  });
});
