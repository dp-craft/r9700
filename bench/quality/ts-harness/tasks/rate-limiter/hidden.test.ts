import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./impl";
import type { Clock } from "../../lib/clock";

function fakeClock(): { clock: Clock; advance: (ms: number) => void } {
  let t = 0;
  return { clock: { now: (): number => t }, advance: (ms: number): void => { t += ms; } };
}

describe("createRateLimiter [hidden edge cases]", () => {
  it("should allow up to capacity when the bucket starts full", () => {
    const { clock } = fakeClock();
    const r = createRateLimiter(3, 1, clock);
    expect(r.tryAcquire("k")).toBe(true);
    expect(r.tryAcquire("k")).toBe(true);
    expect(r.tryAcquire("k")).toBe(true);
    expect(r.tryAcquire("k")).toBe(false);
  });
  it("should refill lazily from elapsed time when time advances", () => {
    const { clock, advance } = fakeClock();
    const r = createRateLimiter(2, 1, clock);
    r.tryAcquire("k");
    r.tryAcquire("k");
    expect(r.tryAcquire("k")).toBe(false);
    advance(1000);
    expect(r.tryAcquire("k")).toBe(true);
    expect(r.tryAcquire("k")).toBe(false);
  });
  it("should isolate buckets when different keys are used", () => {
    const { clock } = fakeClock();
    const r = createRateLimiter(1, 1, clock);
    expect(r.tryAcquire("a")).toBe(true);
    expect(r.tryAcquire("b")).toBe(true);
    expect(r.tryAcquire("a")).toBe(false);
  });
});
