import { describe, it, expect } from "vitest";
import { createLruCache } from "./impl";
import type { Clock } from "../../lib/clock";

function fakeClock(): { clock: Clock; advance: (ms: number) => void } {
  let t = 0;
  return { clock: { now: (): number => t }, advance: (ms: number): void => { t += ms; } };
}

describe("createLruCache [hidden edge cases]", () => {
  it("should evict the least-recently-used entry when capacity is exceeded", () => {
    const { clock } = fakeClock();
    const c = createLruCache<string, number>(2, 100000, clock);
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");            // 'b' is now LRU
    c.set("c", 3);
    expect(c.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
    expect(c.has("c")).toBe(true);
    expect(c.size).toBe(2);
  });
  it("should expire an entry and drop it from size when ttl elapses", () => {
    const { clock, advance } = fakeClock();
    const c = createLruCache<string, number>(10, 500, clock);
    c.set("x", 1);
    advance(600);
    expect(c.get("x")).toBeUndefined();
    expect(c.has("x")).toBe(false);
    expect(c.size).toBe(0);
  });
});
