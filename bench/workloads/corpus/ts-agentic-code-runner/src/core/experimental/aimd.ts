export interface AimdConfig {
  readonly enabled: boolean;
}

export interface AimdState {
  readonly value: number;
}

export const DEFAULT_AIMD_CONFIG: AimdConfig = { enabled: false };

const DECREASE_FACTOR = 0.5;
const INCREASE_STEP = 1;

export function adjust(
  state: AimdState,
  cfg: AimdConfig,
  outcome: 'success' | 'failure'
): AimdState {
  if (!cfg.enabled) {
    return state;
  }

  return outcome === 'success'
    ? { value: state.value + INCREASE_STEP }
    : { value: state.value * DECREASE_FACTOR };
}
