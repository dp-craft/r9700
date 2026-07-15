/** Injectable clock so time-dependent logic (TTL, debounce, rate limits) is testable.
 *  Reuse this Clock — do NOT read Date.now() directly in domain logic. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: (): number => Date.now(),
};
