import { describe, it, expect } from "vitest";
import type { LineItem } from "./types";
import { computeTotal } from "./pricing";
import { amountLabel, buildReport } from "./report";
import { createPriceCache } from "./cache";

const TTL = 60_000;

function deferredItem(id: string, base: number, load: () => Promise<number>): LineItem {
  return { id, base, adjustment: { kind: "deferred", load } };
}

describe("deferred pricing [hidden edge cases]", () => {
  it("should add the loaded value when an adjustment is deferred", async () => {
    const item = deferredItem("d", 100, async (): Promise<number> => 25);
    expect(await computeTotal([item])).toBe(125);
  });

  it("should invoke load exactly once when concurrent quotes share a cache key", async () => {
    let loads = 0;
    const item = deferredItem("d", 100, async (): Promise<number> => {
      loads += 1;
      await Promise.resolve();
      return 25;
    });
    const cache = createPriceCache({ now: (): number => 0 }, TTL);
    const compute = (): Promise<number> => Promise.resolve(computeTotal([item]));
    const [a, b, c] = await Promise.all([
      cache.get("q1", compute),
      cache.get("q1", compute),
      cache.get("q1", compute),
    ]);
    expect(a).toBe(125);
    expect(b).toBe(125);
    expect(c).toBe(125);
    expect(loads).toBe(1);
  });

  it("should retry the computation when the first load rejected", async () => {
    let calls = 0;
    const cache = createPriceCache({ now: (): number => 0 }, TTL);
    const compute = async (): Promise<number> => {
      calls += 1;
      if (calls === 1) {
        throw new Error("rate feed down");
      }
      return 7;
    };
    await expect(cache.get("q1", compute)).rejects.toThrow("rate feed down");
    await expect(cache.get("q1", compute)).resolves.toBe(7);
    expect(calls).toBe(2);
  });

  it("should keep fixed and percent behavior unchanged when the union grows", async () => {
    const items: readonly LineItem[] = [
      { id: "a", base: 100, adjustment: { kind: "fixed", value: 20 } },
      { id: "b", base: 200, adjustment: { kind: "percent", pct: 10 } },
    ];
    expect(await computeTotal(items)).toBe(340);
    expect(amountLabel({ kind: "fixed", value: 20 })).toBe("flat");
    expect(amountLabel({ kind: "percent", pct: 10 })).toBe("rate");
  });

  it("should isolate computations when cache keys differ", async () => {
    const counts = { x: 0, y: 0 };
    const cache = createPriceCache({ now: (): number => 0 }, TTL);
    const cx = async (): Promise<number> => {
      counts.x += 1;
      return 1;
    };
    const cy = async (): Promise<number> => {
      counts.y += 1;
      return 2;
    };
    expect(await cache.get("x", cx)).toBe(1);
    expect(await cache.get("y", cy)).toBe(2);
    expect(counts).toEqual({ x: 1, y: 1 });
  });

  it("should report the resolved total when an adjustment is deferred", async () => {
    const item = deferredItem("d", 100, async (): Promise<number> => 25);
    expect(amountLabel(item.adjustment)).toBe("deferred");
    const lines = await buildReport([item]);
    expect(lines[0]).toContain("deferred");
    expect(lines[0]).toContain("125");
  });
});
