import { describe, it, expect } from "vitest";
import { computeTotal, lineTotal } from "./pricing";
import { amountLabel, buildReport } from "./report";
import { createPriceCache } from "./cache";

describe("pricing", () => {
  it("should add the fixed value when the adjustment is fixed", () => {
    expect(lineTotal({ id: "a", base: 100, adjustment: { kind: "fixed", value: 20 } })).toBe(120);
  });
  it("should apply the rate when the adjustment is a percent", () => {
    expect(lineTotal({ id: "b", base: 200, adjustment: { kind: "percent", pct: 10 } })).toBe(220);
  });
  it("should sum the line totals when computing an order total", () => {
    const items = [
      { id: "a", base: 100, adjustment: { kind: "fixed", value: 20 } },
      { id: "b", base: 200, adjustment: { kind: "percent", pct: 10 } },
    ] as const;
    expect(computeTotal(items)).toBe(340);
  });
});

describe("report", () => {
  it("should label each adjustment when building the report", () => {
    expect(amountLabel({ kind: "fixed", value: 5 })).toBe("flat");
    expect(amountLabel({ kind: "percent", pct: 5 })).toBe("rate");
  });
  it("should render one line per item when building the report", () => {
    const lines = buildReport([{ id: "a", base: 100, adjustment: { kind: "fixed", value: 20 } }]);
    expect(lines).toEqual(["a [flat]: 120"]);
  });
});

describe("createPriceCache", () => {
  it("should reuse the cached total when the entry is still fresh", async () => {
    let calls = 0;
    const cache = createPriceCache({ now: (): number => 0 }, 1000);
    const compute = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    expect(await cache.get("k", compute)).toBe(42);
    expect(await cache.get("k", compute)).toBe(42);
    expect(calls).toBe(1);
  });
  it("should recompute the total when the entry has expired", async () => {
    let t = 0;
    let calls = 0;
    const cache = createPriceCache({ now: (): number => t }, 1000);
    const compute = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    expect(await cache.get("k", compute)).toBe(1);
    t = 1500;
    expect(await cache.get("k", compute)).toBe(2);
    expect(calls).toBe(2);
  });
});
