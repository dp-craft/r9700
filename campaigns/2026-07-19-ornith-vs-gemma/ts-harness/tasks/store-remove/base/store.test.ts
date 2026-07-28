import { describe, it, expect } from "vitest";
import { createStore } from "./store";

describe("createStore", () => {
  it("should accumulate the cached total when entries share a key", () => {
    const s = createStore();
    s.add({ key: "a", amount: 2 });
    s.add({ key: "a", amount: 3 });
    expect(s.total("a")).toBe(5);
  });
});
