/**
 * DoD-gate smoke test for runAgentLoop.
 *
 * TWO paths driven by a runtime model-availability probe (`liveCapable`):
 *
 * LIVE path  — runs only when ollama is reachable AND the resolved model id
 *              (RUNNER_MODEL_ID env var, falling back to 'qwen2.5-coder:7b')
 *              appears in http://127.0.0.1:11434/api/tags. Uses the REAL
 *              connector (no connector mock). Gates are mocked so the loop
 *              completes deterministically without shelling out to lint/tsc.
 *              Asserts result.status === 'completed' + one telemetry row.
 *
 * FIXTURE path — runs when ollama is NOT reachable, OR when reachable but the
 *              resolved model is NOT pulled. Mocks '../llm/connector' to replay a
 *              markdown-fenced model reply string (v1-crash regression: native
 *              tool-calling MUST NOT throw a JSON.parse rejection on fenced
 *              output). Asserts loop reaches completion + one telemetry row.
 *
 * Per R-030: both paths assert observable loop completion (status + telemetry),
 * not merely that a mock was called. Gates are a shell-exec boundary; mocking
 * them is permissible (external process boundary) and needed for determinism.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskSpec } from '../execution/executor';
import { makeTestDeps } from './__tests__/makeTestDeps';
import type { RunnerDeps } from './runner';

// ---------------------------------------------------------------------------
// Model-availability probe — resolved ONCE via vi.hoisted so the factory
// closures in vi.mock (evaluated before beforeEach) can branch on the result.
//
// liveCapable = true only when:
//   1. ollama is reachable at http://127.0.0.1:11434/api/tags (1500ms timeout)
//   2. the resolved model id (RUNNER_MODEL_ID ?? 'qwen2.5-coder:7b') matches
//      a `name` or `model` field in the /api/tags response.
// Any fetch/parse error → liveCapable = false (fixture path).
// ---------------------------------------------------------------------------
const liveCapable = vi.hoisted(async (): Promise<boolean> => {
  const modelId = process.env['RUNNER_MODEL_ID'] ?? 'qwen2.5-coder:7b';
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { models: Array<{ name: string; model: string }> };
    return body.models.some(m => m.name === modelId || m.model === modelId);
  } catch {
    return false;
  }
});

// ---------------------------------------------------------------------------
// FIXTURE reply — realistic markdown-fenced code block.
// This is the v1-crash regression: if the loop tries JSON.parse on fenced
// output it throws a SyntaxError.  Completing without that error validates fix.
// ---------------------------------------------------------------------------
const FIXTURE_FENCED_REPLY = `Here is the implementation:

\`\`\`typescript
export const add = (a: number, b: number): number => a + b;
\`\`\`

All done.`;

// ---------------------------------------------------------------------------
// Connector mock — real module on the LIVE path; stub on the FIXTURE path.
// ---------------------------------------------------------------------------
vi.mock('../llm/connector', async importOriginal => {
  const capable = await liveCapable;
  if (capable) {
    return importOriginal<typeof import('../llm/connector')>();
  }
  return {
    createModel: vi.fn(() => ({ provider: 'stub', modelId: 'fixture' })),
    generate: vi.fn(() => Promise.resolve({ text: FIXTURE_FENCED_REPLY, toolCallCount: 0 })),
    resolveOllamaNumCtx: vi.fn(() => 65536),
  };
});

// ---------------------------------------------------------------------------
// Gates mock — always stubbed (gates shell out to lint/tsc/test; those are
// external-process boundaries). On both paths gates return "pass" so the impl
// pipeline completes in one attempt without running npm/tsc in CI.
// ---------------------------------------------------------------------------
vi.mock('../gates/gates', async importOriginal => {
  const actual = await importOriginal<typeof import('../gates/gates')>();
  const passGate = vi.fn(async () => null); // null = gate passed
  return {
    ...actual,
    lintGate: passGate,
    scopedLintGate: vi.fn(() => passGate),
    tscGate: passGate,
    testGate: passGate,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSpec = (): TaskSpec => ({
  agentType: 'code-logic-writer',
  navBundlePath: 'specs/T999-smoke/nav/T999.json',
  targetFiles: ['tools/agentic-code-runner/src/core/__fixtures__/add.ts'],
});

const makeDeps = (): RunnerDeps => ({
  mode: 'impl',
  runTests: async () => ({ passed: true, output: '', noTests: false }),
  ...makeTestDeps(),
});

const readTelemetryRows = (
  dbPath: string
): Array<{ duration_ms: number; final_rung: string; status: string }> => {
  const db = new Database(dbPath, { readonly: true });
  const rows = db.prepare('SELECT * FROM task_runs').all() as Array<{
    duration_ms: number;
    final_rung: string;
    status: string;
  }>;
  db.close();
  return rows;
};

// ---------------------------------------------------------------------------
// FIXTURE path — runs when ollama is NOT reachable
// ---------------------------------------------------------------------------

describe('runAgentLoop smoke — fixture path (ollama unreachable or model not pulled)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runner-smoke-'));
    dbPath = join(tmpDir, 'telemetry.sqlite');
    process.env['RUNNER_TELEMETRY_DB'] = dbPath;
  });

  afterEach(() => {
    delete process.env['RUNNER_TELEMETRY_DB'];
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should reach completed status when connector returns a fenced reply', async () => {
    if (await liveCapable) {
      return; // LIVE path covers this; skip here
    }

    const { runAgentLoop } = await import('./runner');
    const result = await runAgentLoop(makeSpec(), makeDeps());

    expect(result.status).toBe('completed');
  }, 15_000);

  it('should write exactly one task_runs row with non-null duration_ms, final_rung, and status', async () => {
    if (await liveCapable) {
      return;
    }

    const { runAgentLoop } = await import('./runner');
    await runAgentLoop(makeSpec(), makeDeps());

    const rows = readTelemetryRows(dbPath);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.duration_ms).not.toBeNull();
    expect(rows[0]?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.final_rung).toBeTruthy();
    expect(rows[0]?.status).toBeTruthy();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// FIXTURE path — ui-writer two-role TDD (RED→GREEN driven via deps.runTests)
// ---------------------------------------------------------------------------

const makeUiSpec = (): TaskSpec => ({
  agentType: 'ui-writer',
  navBundlePath: 'specs/T998-ui-smoke/nav/T998.json',
  targetFiles: ['tools/agentic-code-runner/src/core/__fixtures__/Badge.tsx'],
});

describe('runAgentLoop smoke — ui-writer two-role TDD (fixture path)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runner-smoke-ui-'));
    dbPath = join(tmpDir, 'telemetry.sqlite');
    process.env['RUNNER_TELEMETRY_DB'] = dbPath;
  });

  afterEach(() => {
    delete process.env['RUNNER_TELEMETRY_DB'];
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should drive RED→GREEN to completed for the ui-writer test+code roles', async () => {
    if (await liveCapable) {
      return; // LIVE path is not exercised for this two-role fixture case
    }

    // Stateful runTests: first call (RED) fails, subsequent calls (GREEN) pass.
    let calls = 0;
    const deps: RunnerDeps = {
      mode: 'tdd',
      runTests: async () => {
        calls += 1;
        return calls === 1
          ? { passed: false, output: 'fail', noTests: false }
          : { passed: true, output: 'pass', noTests: false };
      },
      ...makeTestDeps(),
    };

    const { runAgentLoop } = await import('./runner');
    const result = await runAgentLoop(makeUiSpec(), deps);

    expect(result.status).toBe('completed');
    expect(result.redObserved).toBe(true);
    expect(result.greenObserved).toBe(true);

    const rows = readTelemetryRows(dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBeTruthy();
  }, 15_000);
});

// ---------------------------------------------------------------------------
// LIVE path — skipped when ollama is unreachable
// ---------------------------------------------------------------------------

describe('runAgentLoop smoke — LIVE path (real ollama)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runner-smoke-live-'));
    dbPath = join(tmpDir, 'telemetry.sqlite');
    process.env['RUNNER_TELEMETRY_DB'] = dbPath;
  });

  afterEach(() => {
    delete process.env['RUNNER_TELEMETRY_DB'];
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should reach completed status against the real default model', async () => {
    if (!(await liveCapable)) {
      return; // model not available — fixture path covers this environment
    }

    const { runAgentLoop } = await import('./runner');
    const result = await runAgentLoop(makeSpec(), makeDeps());

    expect(result.status).toBe('completed');
  }, 120_000);

  it('should write exactly one task_runs row with non-null duration_ms, final_rung, and status (live)', async () => {
    if (!(await liveCapable)) {
      return;
    }

    const { runAgentLoop } = await import('./runner');
    await runAgentLoop(makeSpec(), makeDeps());

    const rows = readTelemetryRows(dbPath);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.duration_ms).not.toBeNull();
    expect(rows[0]?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.final_rung).toBeTruthy();
    expect(rows[0]?.status).toBeTruthy();
  }, 120_000);
});
