import type { BackendKind, RungName } from '../shared';

// Two-ladder escalation model — there is NO ollama→openrouter cross-fallback.
// A run picks ONE base ladder from its profile's backend and escalates straight
// from that base rung to the terminal `claude` handoff rung:
//   - local base (ollama / openai-compatible) → ['ollama', 'claude']
//   - openrouter base                         → ['openrouter', 'claude']
// `claude` is the terminal HANDOFF rung — the runner never generates on it.
// Reaching `claude` means the local ladder is exhausted (status local-exhausted);
// the task is handed off for orchestrator/human review, NOT billed to Claude.
export const TERMINAL_RUNG: RungName = 'claude';
export const FAILS_PER_RUNG = 3;

export const LADDERS: Readonly<Record<'ollama' | 'openrouter', readonly RungName[]>> = {
  ollama: ['ollama', TERMINAL_RUNG],
  openrouter: ['openrouter', TERMINAL_RUNG],
};

export interface LadderState {
  readonly rung: RungName;
  readonly consecutiveFails: number;
  readonly exhausted: boolean;
}

export function initLadder(start: RungName = 'ollama'): LadderState {
  return { rung: start, consecutiveFails: 0, exhausted: false };
}

export function startRungForBackend(backend: BackendKind): RungName {
  return backend === 'openrouter' ? 'openrouter' : 'ollama';
}

const isLastRung = (rung: RungName): boolean => rung === TERMINAL_RUNG;

export function recordFailure(state: LadderState): LadderState {
  if (state.exhausted) {
    return state;
  }
  const fails = state.consecutiveFails + 1;
  if (fails < FAILS_PER_RUNG) {
    return { ...state, consecutiveFails: fails };
  }
  // FAILS_PER_RUNG reached on the base rung → escalate straight to the terminal
  // claude handoff, which exhausts the ladder (no intermediate rung).
  return { rung: TERMINAL_RUNG, consecutiveFails: 0, exhausted: true };
}

// Force escalation regardless of the consecutive-fail count (a connectivity
// failure on a rung cannot be retried into success — escalate immediately). From
// the base rung this jumps straight to the terminal claude handoff and exhausts;
// on the terminal rung or already-exhausted it just marks exhausted.
export function forceEscalate(state: LadderState): LadderState {
  if (state.exhausted || isLastRung(state.rung)) {
    return { ...state, exhausted: true };
  }
  return { rung: TERMINAL_RUNG, consecutiveFails: 0, exhausted: true };
}

export function recordSuccess(state: LadderState): LadderState {
  return { ...state, consecutiveFails: 0 };
}
