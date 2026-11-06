import { describe, it, expect } from "vitest";
import { createStore } from "./store";

describe("Store.remove [hidden edge cases]", () => {
  it("should zero the cached total when every entry for a key is removed", () => {
    const s = createStore();
    s.add({ key: "a", amount: 3 });
    s.add({ key: "a", amount: 4 });
    s.add({ key: "b", amount: 5 });
    s.remove("a");
    expect(s.total("a")).toBe(0);
    expect(s.total("b")).toBe(5);
    expect(s.all().some((e) => e.key === "a")).toBe(false);
  });
  it("should be a no-op when removing a key that has no entries", () => {
    const s = createStore();
    s.add({ key: "a", amount: 2 });
    s.remove("zzz");
    expect(s.total("a")).toBe(2);
    expect(s.all().length).toBe(1);
  });
});
