import { describe, expect, it } from 'vitest';

import {
  type AttemptSignal,
  type ClassifierConfig,
  classifyAttempt,
  countTscErrors,
  isAuthError,
  isConnectivityError,
  isGenerationTimeoutError,
  isNearMiss,
  type NearMissSignal,
  triageFirstAttempt
} from './retryClassifier';

const cfg: ClassifierConfig = { idleTimeoutMs: 1000 };

describe('classifyAttempt', () => {
  it('should return retry when the failure is transient', () => {
    const signal: AttemptSignal = {
      failureKind: 'transient',
      toolActivityCount: 0,
      elapsedMs: 5000,
    };

    expect(classifyAttempt(signal, cfg)).toBe('retry');
  });

  it('should return abort when there is no tool activity past the idle timeout', () => {
    const signal: AttemptSignal = {
      failureKind: 'tool-error',
      toolActivityCount: 0,
      elapsedMs: 1500,
    };

    expect(classifyAttempt(signal, cfg)).toBe('abort');
  });

  it('should return retry on a tool-error within the idle window', () => {
    const signal: AttemptSignal = {
      failureKind: 'tool-error',
      toolActivityCount: 0,
      elapsedMs: 500,
    };

    expect(classifyAttempt(signal, cfg)).toBe('retry');
  });

  it('should return retry when tool activity is present and under the timeout', () => {
    const signal: AttemptSignal = {
      failureKind: 'gate-fail',
      toolActivityCount: 3,
      elapsedMs: 800,
    };

    expect(classifyAttempt(signal, cfg)).toBe('retry');
  });
});

describe('countTscErrors', () => {
  it('should count the number of "error TS" occurrences', () => {
    const output = 'src/a.ts(1,2): error TS2322: x\nsrc/b.ts(3,4): error TS7006: y';

    expect(countTscErrors(output)).toBe(2);
  });

  it('should count case-insensitively', () => {
    expect(countTscErrors('ERROR ts1005 foo error TS2322 bar')).toBe(2);
  });

  it('should return 0 when there are no tsc errors', () => {
    expect(countTscErrors('all files compiled cleanly')).toBe(0);
  });
});

describe('triageFirstAttempt', () => {
  const base: AttemptSignal = { failureKind: 'gate-fail', toolActivityCount: 5, elapsedMs: 100 };
  const manyTscErrors: string = Array.from({ length: 9 }, () => 'x.ts(1,1): error TS2322: bad').join('\n');
  const fewTscErrors: string = Array.from({ length: 3 }, () => 'x.ts(1,1): error TS2322: bad').join('\n');

  it('should abort on attempt 1 when the failure is a tool-error', () => {
    expect(triageFirstAttempt({ ...base, failureKind: 'tool-error' }, '', 1)).toBe('abort');
  });

  it('should abort on attempt 1 when tsc errors exceed the threshold', () => {
    expect(triageFirstAttempt(base, manyTscErrors, 1)).toBe('abort');
  });

  it('should retry on attempt 1 when tsc errors are under the threshold', () => {
    expect(triageFirstAttempt(base, fewTscErrors, 1)).toBe('retry');
  });

  it('should retry on attempt 2 even with a tool-error (triage is attempt-1 only)', () => {
    expect(triageFirstAttempt({ ...base, failureKind: 'tool-error' }, manyTscErrors, 2)).toBe('retry');
  });
});

describe('classifyAttempt triage wiring', () => {
  it('should reach the attempt-1 tool-error triage abort through classifyAttempt', () => {
    const signal: AttemptSignal = {
      failureKind: 'tool-error',
      toolActivityCount: 5,
      elapsedMs: 100,
      attemptNumber: 1,
    };

    expect(classifyAttempt(signal, cfg)).toBe('abort');
  });
});

describe('isConnectivityError', () => {
  it.each([
    'fetch failed',
    'connect ECONNREFUSED 127.0.0.1:11434',
    'getaddrinfo ENOTFOUND api.example.com',
    'getaddrinfo EAI_AGAIN host',
    'request timed out: ETIMEDOUT',
    'socket hang up',
    'request timeout exceeded',
  ])('should return true for connectivity message %j', message => {
    expect(isConnectivityError(message)).toBe(true);
  });

  it('should match case-insensitively', () => {
    expect(isConnectivityError('FETCH FAILED')).toBe(true);
    expect(isConnectivityError('Socket Hang Up')).toBe(true);
  });

  it('should return false for a rate-limit message', () => {
    expect(isConnectivityError('429 Too Many Requests: rate limit exceeded')).toBe(false);
  });

  it('should return false for a generic API error', () => {
    expect(isConnectivityError('400 Bad Request: invalid model id')).toBe(false);
  });
});

describe('isAuthError', () => {
  it.each([
    '[rung:openrouter] 401 Unauthorized',
    'AI_APICallError: 401 No auth credentials found',
    '403 Forbidden',
    'Invalid API key provided',
    'authentication failed',
    'Your API key has expired',
  ])('should return true for auth/credential message %j', message => {
    expect(isAuthError(message)).toBe(true);
  });

  it('should match case-insensitively', () => {
    expect(isAuthError('UNAUTHORIZED: NO AUTH CREDENTIALS')).toBe(true);
  });

  it('should return false for a connectivity message', () => {
    expect(isAuthError('connect ECONNREFUSED 127.0.0.1:11434')).toBe(false);
  });

  it('should return false for a gate-failure message', () => {
    expect(isAuthError('tests did not reach GREEN after the implementation drive')).toBe(false);
    expect(isAuthError('functions exceed the cyclomatic-complexity cap')).toBe(false);
  });
});

describe('isGenerationTimeoutError', () => {
  it('should return true when the message contains the generation-timeout marker', () => {
    expect(
      isGenerationTimeoutError(
        'generation-timeout: no generation activity for 120000ms — aborting drive'
      )
    ).toBe(true);
  });

  it('should return false for a connectivity message that does not contain the marker', () => {
    expect(isGenerationTimeoutError('fetch failed')).toBe(false);
  });

  it('should return false for an unrelated message', () => {
    expect(isGenerationTimeoutError('all good')).toBe(false);
  });
});

describe('isNearMiss', () => {
  const baseSignal: NearMissSignal = {
    failedGate: 'lint',
    aborted: false,
    noProgress: false,
    mutatedCount: 1,
  };

  it.each(['lint', 'tsc', 'test', 'decomposition', 'functional-style'] as const)(
    'should return true when the failed gate is %s and the drive mutated files without aborting or stalling',
    failedGate => {
      const signal: NearMissSignal = { ...baseSignal, failedGate };

      expect(isNearMiss(signal)).toBe(true);
    }
  );

  it('should return false when the drive was aborted even with a self-fixable gate and mutations', () => {
    const signal: NearMissSignal = { ...baseSignal, aborted: true };

    expect(isNearMiss(signal)).toBe(false);
  });

  it('should return false when the drive made no progress even with a self-fixable gate and mutations', () => {
    const signal: NearMissSignal = { ...baseSignal, noProgress: true };

    expect(isNearMiss(signal)).toBe(false);
  });

  it('should return false when the failed gate is \'drive\'', () => {
    const signal: NearMissSignal = { ...baseSignal, failedGate: 'drive' };

    expect(isNearMiss(signal)).toBe(false);
  });

  it('should return false when the failed gate is undefined', () => {
    const signal: NearMissSignal = { ...baseSignal, failedGate: undefined };

    expect(isNearMiss(signal)).toBe(false);
  });

  it('should return false when mutatedCount is zero on an otherwise near-miss signal', () => {
    const signal: NearMissSignal = { ...baseSignal, mutatedCount: 0 };

    expect(isNearMiss(signal)).toBe(false);
  });
});
