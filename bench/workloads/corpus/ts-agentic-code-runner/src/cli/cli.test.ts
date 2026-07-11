import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunResult } from '../core/shared/types';

vi.mock('../core/runner/runTask', () => ({
  runTask: vi.fn(),
}));

const { runTask } = await import('../core/runner/runTask');
const runTaskMock = vi.mocked(runTask);

import { createEmitOnce, handleInterrupt, interruptedResult, main } from './cli';

const completedResult: AgentRunResult = {
  status: 'completed',
  agentType: 'code-logic-writer',
  touchedFiles: ['a.ts'],
  finalRung: 'ollama',
  escalated: false,
  fallbackSanctioned: false,
  attempts: 1,
  redObserved: false,
  greenObserved: false,
  modelId: 'qwen2.5-coder:7b',
};

const NAV = 'specs/branch/nav/T001.json';
const baseArgv = ['--agent', 'code-logic-writer', '--nav', NAV, '--mode', 'impl'];

describe('cli main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTaskMock.mockResolvedValue(completedResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should invoke runTask with parsed RunTaskInput when flags are valid', async () => {
    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      {
        agentType: 'code-logic-writer',
        navBundle: NAV,
        mode: 'impl',
      },
      expect.anything()
    );
  });

  it('should pass profileName when --profile is provided', async () => {
    await main([...baseArgv, '--profile', 'fast']);

    expect(runTaskMock).toHaveBeenCalledWith(
      {
        agentType: 'code-logic-writer',
        navBundle: NAV,
        mode: 'impl',
        profileName: 'fast',
      },
      expect.anything()
    );
  });

  it('should print the runner capabilities JSON and exit 0 for --capabilities (no runTask)', async () => {
    const logSpy = vi.spyOn(console, 'log');

    const code = await main(['--capabilities']);

    expect(code).toBe(0);
    expect(runTaskMock).not.toHaveBeenCalled();
    const printed = JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null') as {
      schema: string;
      build: string;
      agentTypes: string[];
    };
    expect(printed.schema).toBe('runner-capabilities/v2');
    expect(printed.build).toBe('none (tsx)');
    expect(printed.agentTypes).toContain('code-logic-writer');
  });

  it('should print the AgentRunResult as parseable JSON to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await main(baseArgv);

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(completedResult));
    const printed: unknown = JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null');
    expect(printed).toEqual(completedResult);
  });

  it('should return exit code 0 when runTask resolves status completed', async () => {
    const code = await main(baseArgv);

    expect(code).toBe(0);
  });

  it('should return a non-zero exit code when status is failed', async () => {
    runTaskMock.mockResolvedValue({ ...completedResult, status: 'failed' });

    const code = await main(baseArgv);

    expect(code).not.toBe(0);
  });

  it('should return a non-zero exit code when status is local-exhausted', async () => {
    runTaskMock.mockResolvedValue({ ...completedResult, status: 'local-exhausted' });

    const code = await main(baseArgv);

    expect(code).not.toBe(0);
  });

  it('should resolve to a non-zero exit code (not reject) when runTask rejects', async () => {
    runTaskMock.mockRejectedValue(new Error('footprint exceeded: 3 target files (max 2)'));

    const code = await main(baseArgv);

    expect(code).not.toBe(0);
  });

  it('should print a failed AgentRunResult JSON with a non-empty error when runTask rejects', async () => {
    const logSpy = vi.spyOn(console, 'log');
    runTaskMock.mockRejectedValue(new Error('footprint exceeded: 3 target files (max 2)'));

    await main(baseArgv);

    const printed = JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null') as AgentRunResult;
    expect(printed.status).toBe('failed');
    expect(printed.error).toBeTruthy();
  });

  it('should print a usage error and not invoke runTask when --agent is missing', async () => {
    const errSpy = vi.spyOn(console, 'error');

    const code = await main(['--nav', NAV, '--mode', 'impl']);

    expect(code).not.toBe(0);
    expect(errSpy).toHaveBeenCalled();
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('should fail with usage error when --nav is missing', async () => {
    const code = await main(['--agent', 'code-logic-writer', '--mode', 'impl']);

    expect(code).not.toBe(0);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('should fail with usage error when --mode is missing', async () => {
    const code = await main(['--agent', 'code-logic-writer', '--nav', NAV]);

    expect(code).not.toBe(0);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('should fail with usage error when --agent value is not an allowed AgentType', async () => {
    const code = await main(['--agent', 'nonsense', '--nav', NAV, '--mode', 'impl']);

    expect(code).not.toBe(0);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('should accept ui-writer as a valid --agent value and invoke runTask', async () => {
    await main(['--agent', 'ui-writer', '--nav', NAV, '--mode', 'impl']);

    expect(runTaskMock).toHaveBeenCalledWith(
      { agentType: 'ui-writer', navBundle: NAV, mode: 'impl' },
      expect.anything()
    );
  });

  it('should fail with usage error when --mode value is not an allowed RunMode', async () => {
    const code = await main(['--agent', 'code-logic-writer', '--nav', NAV, '--mode', 'bogus']);

    expect(code).not.toBe(0);
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it('should pass rulesPath to runTask when --rules flag is provided', async () => {
    await main([...baseArgv, '--rules', 'r.md']);

    expect(runTaskMock).toHaveBeenCalledWith(
      {
        agentType: 'code-logic-writer',
        navBundle: NAV,
        mode: 'impl',
        rulesPath: 'r.md',
      },
      expect.anything()
    );
  });

  it('should not include rulesPath in the runTask input when --rules flag is absent', async () => {
    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ rulesPath: expect.anything() }),
      expect.anything()
    );
  });

  it('should print a result whose modelId is a string when status is completed', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await main(baseArgv);

    const printed = JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null') as AgentRunResult;
    expect(typeof printed.modelId).toBe('string');
  });

  it('should print a failed terminal result whose modelId is a string when runTask rejects', async () => {
    const logSpy = vi.spyOn(console, 'log');
    runTaskMock.mockRejectedValue(new Error('boom'));

    await main(baseArgv);

    const printed = JSON.parse((logSpy.mock.calls[0]?.[0] as string) ?? 'null') as AgentRunResult;
    expect(printed.status).toBe('failed');
    expect(typeof printed.modelId).toBe('string');
  });
});

describe('cli main RUNNER_PROFILE env fallback', () => {
  const savedProfile = process.env.RUNNER_PROFILE;

  beforeEach(() => {
    vi.clearAllMocks();
    runTaskMock.mockResolvedValue(completedResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RUNNER_PROFILE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedProfile === undefined) delete process.env.RUNNER_PROFILE;
    else process.env.RUNNER_PROFILE = savedProfile;
  });

  it('should fall back to RUNNER_PROFILE env when --profile flag is absent', async () => {
    process.env.RUNNER_PROFILE = 'openrouter-default';

    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      {
        agentType: 'code-logic-writer',
        navBundle: NAV,
        mode: 'impl',
        profileName: 'openrouter-default',
      },
      expect.anything()
    );
  });

  it('should prefer the --profile flag over the RUNNER_PROFILE env', async () => {
    process.env.RUNNER_PROFILE = 'openrouter-default';

    await main([...baseArgv, '--profile', 'local-default']);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileName: 'local-default' }),
      expect.anything()
    );
  });

  it('should not set profileName when neither flag nor env is present', async () => {
    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ profileName: expect.anything() }),
      expect.anything()
    );
  });

  it('should ignore an empty RUNNER_PROFILE env value', async () => {
    process.env.RUNNER_PROFILE = '';

    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ profileName: expect.anything() }),
      expect.anything()
    );
  });
});

describe('cli role-profile vs --profile precedence', () => {
  const savedProfile = process.env.RUNNER_PROFILE;

  beforeEach(() => {
    vi.clearAllMocks();
    runTaskMock.mockResolvedValue(completedResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.RUNNER_PROFILE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedProfile === undefined) delete process.env.RUNNER_PROFILE;
    else process.env.RUNNER_PROFILE = savedProfile;
  });

  it('should let an explicit --profile override a role-selected RUNNER_PROFILE', async () => {
    const { applyRoleProfile } = await import('../core/config/config');
    const { RunnerConfigSchema } = await import('../core/config/config');
    const config = RunnerConfigSchema.parse({
      delegation: 'runner',
      roleProfiles: { 'code-logic-writer': 'cloud' },
      profiles: { cloud: { backend: 'openrouter', modelId: 'qwen/qwen3.6-35b-a3b' } },
    });
    applyRoleProfile(config, 'code-logic-writer');
    expect(process.env.RUNNER_PROFILE).toBe('openrouter-default');

    await main([...baseArgv, '--profile', 'local-default']);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileName: 'local-default' }),
      expect.anything()
    );
  });

  it('should fall back to the role-selected RUNNER_PROFILE env when no --profile flag is given', async () => {
    const { applyRoleProfile, RunnerConfigSchema } = await import('../core/config/config');
    const config = RunnerConfigSchema.parse({
      delegation: 'runner',
      roleProfiles: { 'code-logic-writer': 'cloud' },
      profiles: { cloud: { backend: 'openrouter', modelId: 'qwen/qwen3.6-35b-a3b' } },
    });
    applyRoleProfile(config, 'code-logic-writer');

    await main(baseArgv);

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ profileName: 'openrouter-default' }),
      expect.anything()
    );
  });
});

describe('interruptedResult', () => {
  it('should return status failed when signal is SIGTERM', () => {
    const result = interruptedResult('code-logic-writer', 'SIGTERM');

    expect(result.status).toBe('failed');
  });

  it('should include the signal name in the error field', () => {
    const result = interruptedResult('code-logic-writer', 'SIGTERM');

    expect(result.error).toContain('SIGTERM');
  });

  it('should carry the provided agentType', () => {
    const result = interruptedResult('ts-test-writer', 'SIGTERM');

    expect(result.agentType).toBe('ts-test-writer');
  });

  it('should set touchedFiles to an empty array', () => {
    const result = interruptedResult('code-logic-writer', 'SIGTERM');

    expect(result.touchedFiles).toEqual([]);
  });

  it('should set modelId to unknown', () => {
    const result = interruptedResult('code-logic-writer', 'SIGTERM');

    expect(result.modelId).toBe('unknown');
  });
});

describe('handleInterrupt', () => {
  it('should call emit exactly once with the built result and undefined outPath', async () => {
    const emit = vi
      .fn<(r: AgentRunResult, out: string | undefined) => Promise<void>>()
      .mockResolvedValue(undefined);

    await handleInterrupt('SIGTERM', { agentType: 'code-logic-writer', outPath: undefined, emit });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', agentType: 'code-logic-writer' }),
      undefined
    );
  });

  it('should return a result that deep-equals the interruptedResult for the same inputs', async () => {
    const emit = vi
      .fn<(r: AgentRunResult, out: string | undefined) => Promise<void>>()
      .mockResolvedValue(undefined);
    const expected = interruptedResult('lint-fix-loop', 'SIGINT');

    const actual = await handleInterrupt('SIGINT', {
      agentType: 'lint-fix-loop',
      outPath: undefined,
      emit,
    });

    expect(actual).toEqual(expected);
  });

  it('should forward outPath to emit when provided', async () => {
    const emit = vi
      .fn<(r: AgentRunResult, out: string | undefined) => Promise<void>>()
      .mockResolvedValue(undefined);

    await handleInterrupt('SIGTERM', {
      agentType: 'code-logic-writer',
      outPath: '/tmp/out.json',
      emit,
    });

    expect(emit).toHaveBeenCalledWith(expect.anything(), '/tmp/out.json');
  });
});

describe('createEmitOnce', () => {
  it('should invoke the underlying emitter exactly once when called twice', async () => {
    const spy = vi
      .fn<(r: AgentRunResult, out: string | undefined) => Promise<void>>()
      .mockResolvedValue(undefined);
    const firstResult: AgentRunResult = {
      ...completedResult,
      status: 'completed',
    };
    const secondResult: AgentRunResult = {
      ...completedResult,
      status: 'failed',
    };
    const guarded = createEmitOnce(spy);
    const outPath = '/tmp/out.json';

    await guarded(firstResult, outPath);
    await guarded(secondResult, outPath);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(firstResult, outPath);
  });

  it('should resolve without throwing when called a second time', async () => {
    const spy = vi
      .fn<(r: AgentRunResult, out: string | undefined) => Promise<void>>()
      .mockResolvedValue(undefined);
    const guarded = createEmitOnce(spy);

    await guarded(completedResult, undefined);
    await expect(guarded(completedResult, undefined)).resolves.toBeUndefined();
  });
});

describe('dotEnvDefaults', () => {
  // Import after adding the export — tests will fail RED until implementation exists
  it('should include a key that is in parsed but absent in current', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({ MY_KEY: 'value' }, {});

    expect(result).toEqual({ MY_KEY: 'value' });
  });

  it('should exclude a key that is present in both parsed and current (non-override)', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({ MY_KEY: 'parsed-value' }, { MY_KEY: 'current-value' });

    expect(result).not.toHaveProperty('MY_KEY');
  });

  it('should exclude a key whose parsed value is undefined', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({ MY_KEY: undefined }, {});

    expect(result).not.toHaveProperty('MY_KEY');
  });

  it('should return an empty object when parsed is empty', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({}, {});

    expect(result).toEqual({});
  });
});

describe('isTracingOwnedKey', () => {
  it('should return true for an OTEL_-prefixed key', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('OTEL_EXPORTER_OTLP_ENDPOINT')).toBe(true);
  });

  it('should return true for a CLAUDE_CODE_-prefixed key', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('CLAUDE_CODE_ENABLE_TELEMETRY')).toBe(true);
  });

  it('should return true for a LANGFUSE_-prefixed key', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('LANGFUSE_PUBLIC_KEY')).toBe(true);
  });

  it('should return true for RUNNER_TRACING exactly', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('RUNNER_TRACING')).toBe(true);
  });

  it('should return false for OPENROUTER_API_KEY', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('OPENROUTER_API_KEY')).toBe(false);
  });

  it('should return false for RUNNER_PROVIDER', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('RUNNER_PROVIDER')).toBe(false);
  });

  it('should return false for VITE_OLLAMA_URL', async () => {
    const { isTracingOwnedKey } = await import('./cli');

    expect(isTracingOwnedKey('VITE_OLLAMA_URL')).toBe(false);
  });
});

describe('dotEnvDefaults — tracing key filtering', () => {
  it('should omit RUNNER_TRACING and OTEL_-prefixed keys while keeping non-tracing keys', async () => {
    const { dotEnvDefaults } = await import('./cli');
    const parsed = {
      RUNNER_TRACING: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OPENROUTER_API_KEY: 'k',
      RUNNER_PROVIDER: 'ollama',
    };

    const result = dotEnvDefaults(parsed, {});

    expect(result).not.toHaveProperty('RUNNER_TRACING');
    expect(result).not.toHaveProperty('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(result).toHaveProperty('OPENROUTER_API_KEY', 'k');
    expect(result).toHaveProperty('RUNNER_PROVIDER', 'ollama');
  });

  it('should omit CLAUDE_CODE_-prefixed keys', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({ CLAUDE_CODE_ENABLE_TELEMETRY: '1', MY_KEY: 'v' }, {});

    expect(result).not.toHaveProperty('CLAUDE_CODE_ENABLE_TELEMETRY');
    expect(result).toHaveProperty('MY_KEY', 'v');
  });

  it('should omit LANGFUSE_-prefixed keys', async () => {
    const { dotEnvDefaults } = await import('./cli');

    const result = dotEnvDefaults({ LANGFUSE_PUBLIC_KEY: 'pk', MY_KEY: 'v' }, {});

    expect(result).not.toHaveProperty('LANGFUSE_PUBLIC_KEY');
    expect(result).toHaveProperty('MY_KEY', 'v');
  });
});

describe('cli config wiring', () => {
  it('should re-export loadRunnerConfig as an importable function', async () => {
    const config = await import('../core/config/config');

    expect(typeof config.loadRunnerConfig).toBe('function');
  });
});

describe('cli main --out', () => {
  const outPath = join(tmpdir(), `runner-out-${process.pid}`, 'result.json');

  beforeEach(() => {
    vi.clearAllMocks();
    runTaskMock.mockResolvedValue(completedResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(join(tmpdir(), `runner-out-${process.pid}`), { recursive: true, force: true });
  });

  it('should write the result JSON to the --out path (creating the dir)', async () => {
    await main([...baseArgv, '--out', outPath]);

    const written = await readFile(outPath, 'utf8');
    expect(JSON.parse(written)).toEqual(completedResult);
  });

  it('should keep stdout console.log when --out is provided', async () => {
    const logSpy = vi.spyOn(console, 'log');

    await main([...baseArgv, '--out', outPath]);

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(completedResult));
  });
});
