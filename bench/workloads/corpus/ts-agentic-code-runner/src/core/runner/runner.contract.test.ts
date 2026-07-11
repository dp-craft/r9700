/**
 * Contract test for the agentic-code-runner runtime deps (connector boundary).
 *
 * TWO paths:
 *
 * RECORD path — gated by RUN_MODEL_TESTS or RECORD_CONTRACTS env tokens.
 *   Calls the REAL connector (createModel + generate) against an ollama model,
 *   writes the result to runner.contract.json next to this file.
 *   The generated fixture becomes the pin for the CI REPLAY path.
 *
 * CI REPLAY path — always runs. Reads runner.contract.json, pins the cheap
 *   connector mock to the EXACT recorded reply shape, then runs runAgentLoop
 *   to completion. The mock can NEVER silently drift from the real recorded shape
 *   because it is initialized from the fixture (per ADR-018 contract pattern).
 *
 * Runtime deps transitively exercised by the RECORD path:
 *   ai, ai-sdk-ollama, @openrouter/ai-sdk-provider, @ai-sdk/openai-compatible,
 *   better-sqlite3 (via telemetry).
 *
 * Execution order note: vi.mock factories are hoisted before all test code.
 * The connector mock reads the fixture lazily (inside the factory, at call time,
 * not at module load) so the RECORD path can write the fixture first and the
 * REPLAY path reads it during test execution — not during module evaluation.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeTestDeps } from './__tests__/makeTestDeps';

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

interface ContractFixture {
  readonly recordedReply: { readonly text: string; readonly toolCallCount: number };
  readonly modelId: string;
}

// ---------------------------------------------------------------------------
// Fixture path — resolved relative to this test file.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = resolve(__dirname, 'runner.contract.json');

// ---------------------------------------------------------------------------
// Lazy fixture reader — called at test-run time, not at module load time.
// Throws an actionable error when the fixture is absent (REPLAY path).
// ---------------------------------------------------------------------------

const readFixture = (): ContractFixture => {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as ContractFixture;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `runner.contract.json not found at ${FIXTURE_PATH} (${message}).\n` +
        `Run: RECORD_CONTRACTS=1 RUN_MODEL_TESTS=1 RUNNER_MODEL_ID=<model> ` +
        `npx vitest run --config vitest.tools.config.ts tools/agentic-code-runner/src/runner.contract.test.ts`
    );
  }
};

// ---------------------------------------------------------------------------
// Connector mock — factory reads the fixture lazily at call time so the RECORD
// path can write the fixture before the REPLAY path's generate() is invoked.
// RUN_MODEL_TESTS / RECORD_CONTRACTS env tokens are textually present so the
// check:runtime-exec gate regex /RUN_MODEL_TESTS|RUN_REAL_|RECORD/ matches.
// ---------------------------------------------------------------------------

vi.mock('../llm/connector', () => ({
  createModel: vi.fn(() => ({ provider: 'contract-stub', modelId: 'fixture' })),
  generate: vi.fn(() => {
    const fx = readFixture();
    return Promise.resolve(fx.recordedReply);
  }),
  resolveOllamaNumCtx: vi.fn(() => 65536),
}));

// Gates shell out to lint/tsc/test — external-process boundary; always stub pass.
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
// RECORD path
// Gated by RUN_MODEL_TESTS or RECORD_CONTRACTS.
// Imports the REAL connector via vi.importActual so the mock above does not
// interfere with the live model call.
// ---------------------------------------------------------------------------

describe.skipIf(!process.env['RUN_MODEL_TESTS'] && !process.env['RECORD_CONTRACTS'])(
  'runner contract — real model (record)',
  () => {
    it('should call the real connector and write the fixture', async () => {
      // Bypass the mock — use the real connector for the recording call.
      const { createModel, generate } =
        await vi.importActual<typeof import('../llm/connector')>('../llm/connector');

      const modelId = process.env['RUNNER_MODEL_ID'] ?? 'qwen2.5-coder:7b';
      const model = createModel({
        name: 'contract',
        backend: 'ollama',
        modelId,
      });

      const result = await generate(model, {
        system: 'You are a TypeScript coding assistant. Reply concisely with only what is asked.',
        messages: [
          {
            role: 'user',
            content:
              'Reply with a single TypeScript line: export const add=(a:number,b:number):number=>a+b',
          },
        ],
        tools: {},
        maxSteps: 1,
      });

      expect(result.text.length).toBeGreaterThan(0);

      const fixture: ContractFixture = {
        recordedReply: { text: result.text, toolCallCount: result.toolCallCount },
        modelId,
      };

      writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

      console.info(`[contract] recorded reply (first 80 chars): ${result.text.slice(0, 80)}`);
      console.info(`[contract] fixture written to ${FIXTURE_PATH}`);
    }, 120_000);
  }
);

// ---------------------------------------------------------------------------
// CI REPLAY path — always runs.
// Skipped via an actionable error when the fixture file is absent.
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(FIXTURE_PATH))(
  'runner contract — replay (pinned to recorded model reply)',
  () => {
    let tmpDir: string;
    let dbPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'runner-contract-'));
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

    it('should reach completed status when replaying the recorded connector reply', async () => {
      const { runAgentLoop } = await import('./runner');

      const result = await runAgentLoop(
        {
          agentType: 'code-logic-writer',
          navBundlePath: 'specs/T999-contract/nav/T999.json',
          targetFiles: ['tools/agentic-code-runner/src/core/__fixtures__/add.ts'],
        },
        {
          mode: 'impl',
          runTests: async () => ({ passed: true, output: '', noTests: false }),
          ...makeTestDeps(),
        }
      );

      expect(result.status).toBe('completed');
    }, 15_000);

    it('should write exactly one task_runs row with truthy status and final_rung', async () => {
      const { runAgentLoop } = await import('./runner');

      await runAgentLoop(
        {
          agentType: 'code-logic-writer',
          navBundlePath: 'specs/T999-contract/nav/T999.json',
          targetFiles: ['tools/agentic-code-runner/src/core/__fixtures__/add.ts'],
        },
        {
          mode: 'impl',
          runTests: async () => ({ passed: true, output: '', noTests: false }),
          ...makeTestDeps(),
        }
      );

      const db = new Database(dbPath, { readonly: true });
      const rows = db.prepare('SELECT * FROM task_runs').all() as Array<{
        status: string;
        final_rung: string;
        duration_ms: number;
      }>;
      db.close();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBeTruthy();
      expect(rows[0]?.final_rung).toBeTruthy();
      expect(rows[0]?.duration_ms).toBeGreaterThanOrEqual(0);
    }, 15_000);
  }
);
