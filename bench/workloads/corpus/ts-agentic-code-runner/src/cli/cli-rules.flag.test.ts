import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/llm/connector', () => ({
  createModel: vi.fn(() => ({ provider: 'stub' })),
  generate: vi.fn(() => Promise.resolve({ text: 'ok', toolCallCount: 0 })),
  resolveOllamaNumCtx: vi.fn(() => 65536),
}));

vi.mock('../gates/gates', () => ({
  lintGate: async () => null,
  scopedLintGate: () => async () => null,
  tscGate: async () => null,
  testGate: async () => null,
  scopedTestGate: () => async () => null,
  decompositionGate: async () => null,
  functionalStyleGate: async () => null,
  VITEST_BIN: './node_modules/.bin/vitest',
}));

vi.mock('../reporting/telemetry', () => ({
  openTelemetry: () => ({ recordRun() {}, close() {} }),
  toTaskRunRow: () => ({}),
}));

const { generate } = await import('../core/llm/connector');
const generateMock = vi.mocked(generate);

import { main } from './cli';

const NAV_BUNDLE_CONTENTS = JSON.stringify({
  specExcerpts: [{ anchor: 'x', text: 'Edit `src/x.ts` to add the feature.' }],
});

describe('cli --rules flag integration', () => {
  let tmpDir: string;
  let navPath: string;
  let originalRulesPath: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    generateMock.mockResolvedValue({ text: 'ok', toolCallCount: 0 });
    originalRulesPath = process.env.RUNNER_RULES_PATH;

    tmpDir = mkdtempSync(join(tmpdir(), 'cli-rules-flag-test-'));
    navPath = join(tmpDir, 'T001.json');
    writeFileSync(navPath, NAV_BUNDLE_CONTENTS, 'utf8');
  });

  afterEach(() => {
    if (originalRulesPath === undefined) {
      delete process.env.RUNNER_RULES_PATH;
    } else {
      process.env.RUNNER_RULES_PATH = originalRulesPath;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('should inject custom rules body into the system prompt and strip frontmatter when --rules points to a temp file with YAML frontmatter', async () => {
    const rulesPath = join(tmpDir, 'custom-rules.md');
    writeFileSync(
      rulesPath,
      `---\nname: x\ndescription: y\n---\nSome body text.\nRULESFLAG_SENTINEL_BODY\n`,
      'utf8'
    );

    await main([
      '--agent',
      'code-logic-writer',
      '--nav',
      navPath,
      '--mode',
      'impl',
      '--rules',
      rulesPath,
    ]);

    const calls = generateMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const capturedSystem: string = (calls[0]?.[1] as { system: string }).system;

    expect(capturedSystem).toContain('RULESFLAG_SENTINEL_BODY');
    expect(capturedSystem).not.toContain('name: x');
    expect(capturedSystem).not.toContain('description: y');
    expect(capturedSystem).not.toContain('Rules Digest');
  });

  it('should expand @-imports and produce a substantially larger system prompt when --rules points to a real agent file with @-imports', async () => {
    const agentFilePath = join(process.cwd(), '.claude/agents/code-logic-writer.md');

    await main([
      '--agent',
      'code-logic-writer',
      '--nav',
      navPath,
      '--mode',
      'impl',
      '--rules',
      agentFilePath,
    ]);

    const calls = generateMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const capturedSystem: string = (calls[0]?.[1] as { system: string }).system;

    expect(capturedSystem.length).toBeGreaterThan(2000);
    expect(capturedSystem).toContain('Single Responsibility Orientation');
    expect(capturedSystem).not.toMatch(/^description:/m);
  });
});
