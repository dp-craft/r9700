import { describe, expect, it } from 'vitest';

import {
  FAILS_PER_RUNG,
  forceEscalate,
  initLadder,
  LADDERS,
  type LadderState,
  recordFailure,
  recordSuccess,
  startRungForBackend
} from './escalation';

const failN = (state: LadderState, n: number): LadderState =>
  Array.from({ length: n }).reduce<LadderState>(acc => recordFailure(acc), state);

describe('initLadder', () => {
  it('should start on the ollama rung by default with zero fails and not exhausted', () => {
    expect(initLadder()).toEqual({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
  });

  it('should start on the openrouter rung when given openrouter as the start', () => {
    expect(initLadder('openrouter')).toEqual({
      rung: 'openrouter',
      consecutiveFails: 0,
      exhausted: false,
    });
  });
});

describe('startRungForBackend', () => {
  it('should map the openrouter backend to the openrouter start rung', () => {
    expect(startRungForBackend('openrouter')).toBe('openrouter');
  });

  it('should map the ollama backend to the ollama start rung', () => {
    expect(startRungForBackend('ollama')).toBe('ollama');
  });

  it('should map the openai-compatible backend to the ollama start rung', () => {
    expect(startRungForBackend('openai-compatible')).toBe('ollama');
  });
});

describe('LADDERS', () => {
  it('should expose two independent base ladders each terminating at claude', () => {
    expect(LADDERS).toEqual({
      ollama: ['ollama', 'claude'],
      openrouter: ['openrouter', 'claude'],
    });
  });
});

describe('recordFailure', () => {
  it('should escalate straight to the exhausted claude rung after three fails on ollama', () => {
    const result = failN(initLadder(), FAILS_PER_RUNG);

    expect(result).toEqual({ rung: 'claude', consecutiveFails: 0, exhausted: true });
  });

  it('should escalate straight to the exhausted claude rung after three fails on openrouter', () => {
    const result = failN(initLadder('openrouter'), FAILS_PER_RUNG);

    expect(result).toEqual({ rung: 'claude', consecutiveFails: 0, exhausted: true });
  });

  it('should accumulate fails without escalating before the threshold', () => {
    const result = failN(initLadder(), FAILS_PER_RUNG - 1);

    expect(result).toEqual({ rung: 'ollama', consecutiveFails: 2, exhausted: false });
  });

  it('should stay exhausted on the claude rung when failing after exhaustion', () => {
    const exhausted = failN(initLadder(), FAILS_PER_RUNG);

    expect(recordFailure(exhausted)).toEqual(exhausted);
  });

  it('should return a new state object without mutating the input', () => {
    const initial = initLadder();
    const next = recordFailure(initial);

    expect(next).not.toBe(initial);
    expect(initial.consecutiveFails).toBe(0);
  });
});

describe('forceEscalate', () => {
  it('should jump from the ollama base rung straight to the exhausted claude rung', () => {
    const onOllama: LadderState = { rung: 'ollama', consecutiveFails: 2, exhausted: false };

    expect(forceEscalate(onOllama)).toEqual({
      rung: 'claude',
      consecutiveFails: 0,
      exhausted: true,
    });
  });

  it('should jump from the openrouter base rung straight to the exhausted claude rung', () => {
    const onOpenrouter: LadderState = { rung: 'openrouter', consecutiveFails: 1, exhausted: false };

    expect(forceEscalate(onOpenrouter)).toEqual({
      rung: 'claude',
      consecutiveFails: 0,
      exhausted: true,
    });
  });

  it('should mark exhausted without advancing when already on the claude rung', () => {
    const onClaude: LadderState = { rung: 'claude', consecutiveFails: 0, exhausted: false };

    expect(forceEscalate(onClaude)).toEqual({ rung: 'claude', consecutiveFails: 0, exhausted: true });
  });

  it('should be idempotent once the ladder is exhausted', () => {
    const exhausted: LadderState = { rung: 'claude', consecutiveFails: 0, exhausted: true };

    expect(forceEscalate(exhausted)).toEqual(exhausted);
  });

  it('should return a new state object without mutating the input', () => {
    const initial = initLadder();
    const next = forceEscalate(initial);

    expect(next).not.toBe(initial);
    expect(initial.rung).toBe('ollama');
  });
});

describe('recordSuccess', () => {
  it('should reset the counter without advancing the rung', () => {
    const afterTwoFails = failN(initLadder(), 2);
    const result = recordSuccess(afterTwoFails);

    expect(result).toEqual({ rung: 'ollama', consecutiveFails: 0, exhausted: false });
  });
});
