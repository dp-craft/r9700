import type { AgentRunResult } from '../shared';
import type { Progress } from './progress';
import { openTelemetry, type RunMeta, toAttemptRunRow, toTaskRunRow } from './telemetry';

const DEFAULT_TELEMETRY_DB = '.agentic-runner/telemetry.sqlite';

// Persist a completed run (+ its per-attempt rows) to the telemetry store. Best
// effort: any failure is logged and swallowed so telemetry never fails a run.
export const recordTelemetry = (
  result: AgentRunResult,
  startedAt: number,
  progress: Progress
): void => {
  try {
    const dbPath = process.env.RUNNER_TELEMETRY_DB ?? DEFAULT_TELEMETRY_DB;
    const store = openTelemetry(dbPath);
    const meta: RunMeta = {
      traceId: crypto.randomUUID(),
      spanId: crypto.randomUUID(),
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
    };
    store.recordRun(toTaskRunRow(result, meta));
    (result.attemptRecords ?? []).forEach(rec => store.recordAttempt(toAttemptRunRow(rec, meta.traceId)));
    store.close();
    progress.event('telemetry', 'recorded');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[runner] telemetry write failed: ${message}`);
  }
};
