/**
 * IMPL-mode preload KEYSTONE stress test for runAgentLoop.
 *
 * Proves the impl-mode kickoff suffix (`buildImplPreload`) actually reaches the
 * model — i.e. the full target source + failing-test source are concatenated
 * into the code-drive prompt that `generate` receives. This is the offline
 * (FIXTURE-path) equivalent of the live Ollama bench (scratchpad/impl-bench.sh):
 * Ollama is unreachable here, so `./connector` is mocked and we inspect the
 * captured `generate(model, req)` call's `req.messages` directly.
 *
 * Two cases:
 *   1. FULL-FILE   — target < MAX_PRELOAD_FILE_CHARS (80000): the WHOLE source
 *                    (sentinel included) plus the failing-test source (its own
 *                    sentinel) plus the CODE_DRIVE_CONTRACT text reach the prompt.
 *   2. SIZE-GUARD  — target > 80000: full-file injection is SKIPPED (a top-of-file
 *                    MIDFILE_SENTINEL is absent) but the tail fallback still fires
 *                    (a last-line TAIL_SENTINEL is present). Preload uses a plain
 *                    tail window (TARGET_TAIL_LINES), NOT head/tail truncation, so a
 *                    top-of-file sentinel is the reliable absence probe.
 *
 * Mirrors runner.smoke.test.ts: same connector/gates mocks, same liveCapable
 * guard so the assertions run only on the FIXTURE path (no real ollama).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { TaskSpec } from '../execution/executor';
import { generate } from '../llm/connector';
import { makeTestDeps } from './__tests__/makeTestDeps';
import type { RunnerDeps } from './runner';

// ---------------------------------------------------------------------------
// Model-availability probe — identical to runner.smoke.test.ts. liveCapable is
// true only when ollama is reachable AND the resolved model is pulled; any
// fetch/parse error → false (FIXTURE path, where these assertions run).
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

const FIXTURE_FENCED_REPLY = `Here is the implementation:

\`\`\`typescript
export const placeholder = (): number => 0;
\`\`\`

All done.`;

// Connector mock — real module on the LIVE path; stub on the FIXTURE path. The
// stubbed `generate` records every call so the prompt text can be inspected.
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

// Gates mock — always pass so the impl pipeline completes in one attempt without
// shelling out to lint/tsc/test.
vi.mock('../gates/gates', async importOriginal => {
  const actual = await importOriginal<typeof import('../gates/gates')>();
  const passGate = vi.fn(async () => null);
  return {
    ...actual,
    lintGate: passGate,
    scopedLintGate: vi.fn(() => passGate),
    tscGate: passGate,
    testGate: passGate,
  };
});

// ---------------------------------------------------------------------------
// On-disk fixtures — buildImplPreload reads spec.targetFiles[0] and
// spec.existingTests[].path from the REAL fs (default reader), relative to the
// repo-root cwd of the vitest run. Generated in beforeAll, removed in afterAll.
// ---------------------------------------------------------------------------
const FIXTURE_REL_DIR = 'tools/agentic-code-runner/src/core/__fixtures__/preload-stress';
const FIXTURE_ABS_DIR = join(process.cwd(), FIXTURE_REL_DIR);

// Distinctive, collision-proof sentinels.
const SENTINEL_FULLFILE_TARGET = 'ZZ_SENTINEL_FULLFILE_TARGET_7Qn';
const SENTINEL_FAILING_TEST = 'ZZ_SENTINEL_FAILING_TEST_4Wb';
const MIDFILE_SENTINEL = 'ZZ_MIDFILE_SENTINEL_3Kx';
const TAIL_SENTINEL = 'ZZ_TAIL_SENTINEL_8Vp';

const FULL_TARGET_REL = `${FIXTURE_REL_DIR}/target-full.ts`;
const FAILING_TEST_REL = `${FIXTURE_REL_DIR}/target-full.test.ts`;
const OVERSIZE_TARGET_REL = `${FIXTURE_REL_DIR}/target-oversize.ts`;

const fullTargetSource = `// preload stress fixture — full-file injection case
export const ${SENTINEL_FULLFILE_TARGET} = 0;
export const placeholder = (): number => 0;
`;

const failingTestSource = `// preload stress fixture — failing test source
import { describe, expect, it } from 'vitest';

import { placeholder } from './target-full';

describe('${SENTINEL_FAILING_TEST}', () => {
  it('should return one', () => {
    expect(placeholder()).toBe(1);
  });
});
`;

// > MAX_PRELOAD_FILE_CHARS (80000): MIDFILE sentinel near the top (line ~3),
// TAIL sentinel on the very last line, ~2000 filler lines in between.
const buildOversizeSource = (): string => {
  const fillerLines = Array.from(
    { length: 2000 },
    (_unused, i) => `export const filler_${i} = ${i}; // padding line to exceed the preload char ceiling`
  );
  return [
    '// preload stress fixture — size-guard case',
    `// ${MIDFILE_SENTINEL} (near the top — beyond the tail window)`,
    ...fillerLines,
    `// ${TAIL_SENTINEL}`,
  ].join('\n');
};

beforeAll(() => {
  mkdirSync(FIXTURE_ABS_DIR, { recursive: true });
  writeFileSync(join(FIXTURE_ABS_DIR, 'target-full.ts'), fullTargetSource, 'utf8');
  writeFileSync(join(FIXTURE_ABS_DIR, 'target-full.test.ts'), failingTestSource, 'utf8');
  writeFileSync(join(FIXTURE_ABS_DIR, 'target-oversize.ts'), buildOversizeSource(), 'utf8');
});

afterAll(() => {
  try {
    rmSync(FIXTURE_ABS_DIR, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const generateMock = generate as unknown as Mock;

const makeDeps = (): RunnerDeps => ({
  mode: 'impl',
  runTests: async () => ({ passed: true, output: '', noTests: false }),
  ...makeTestDeps(),
});

// Concatenate the user-message text of every captured generate() call — the
// code drive's message carries `kickoff + buildImplPreload(spec)`.
const capturedPromptText = (): string =>
  generateMock.mock.calls
    .map(call => {
      const req = call[1] as { messages: readonly { content: unknown }[] };
      return req.messages
        .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
    })
    .join('\n');

// ---------------------------------------------------------------------------
// FIXTURE path — preload keystone stress assertions
// ---------------------------------------------------------------------------

describe('runAgentLoop preload keystone — FIXTURE path (ollama unreachable)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'runner-preload-stress-'));
    process.env['RUNNER_TELEMETRY_DB'] = join(tmpDir, 'telemetry.sqlite');
  });

  afterEach(() => {
    delete process.env['RUNNER_TELEMETRY_DB'];
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should inject the full target source, the failing-test source, and the code-drive contract into the code-drive prompt when the target is under the size ceiling', async () => {
    if (await liveCapable) {
      return; // LIVE path uses the real connector — no mock.calls to inspect.
    }

    const spec: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'specs/T997-preload/nav/T997.json',
      targetFiles: [FULL_TARGET_REL],
      existingTests: [{ path: FAILING_TEST_REL, describeItTree: [] }],
    };

    const { runAgentLoop } = await import('./runner');
    await runAgentLoop(spec, makeDeps());

    const prompt = capturedPromptText();
    expect(prompt).toContain(SENTINEL_FULLFILE_TARGET); // (a) full source injected
    expect(prompt).toContain(SENTINEL_FAILING_TEST); // (b) failing-test source injected
    expect(prompt).toContain('harness'); // (c) CODE_DRIVE_CONTRACT phrase
  }, 15_000);

  it('should skip full-file injection but keep the tail fallback when the target exceeds the size ceiling', async () => {
    if (await liveCapable) {
      return;
    }

    const spec: TaskSpec = {
      agentType: 'code-logic-writer',
      navBundlePath: 'specs/T996-preload/nav/T996.json',
      targetFiles: [OVERSIZE_TARGET_REL],
    };

    const { runAgentLoop } = await import('./runner');
    await runAgentLoop(spec, makeDeps());

    const prompt = capturedPromptText();
    expect(prompt).not.toContain(MIDFILE_SENTINEL); // full-file injection skipped
    expect(prompt).toContain(TAIL_SENTINEL); // tail fallback still fires
  }, 15_000);
});
