import { describe, it, expect } from "vitest";
import { createAsyncMemo } from "./impl";

describe("createAsyncMemo [hidden edge cases]", () => {
  it("should call fn once when several calls share a key concurrently", async () => {
    let calls = 0;
    const memo = createAsyncMemo<string, number>(async () => {
      calls += 1;
      await Promise.resolve();
      return 1;
    });
    await Promise.all([memo("k"), memo("k"), memo("k")]);
    expect(calls).toBe(1);
  });
  it("should retry fn when the first computation rejected", async () => {
    let calls = 0;
    const memo = createAsyncMemo<string, number>(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return 42;
    });
    await expect(memo("k")).rejects.toThrow("boom");
    await expect(memo("k")).resolves.toBe(42);
    expect(calls).toBe(2);
  });
  it("should reuse the cached value when the key already resolved", async () => {
    let calls = 0;
    const memo = createAsyncMemo<string, number>(async () => {
      calls += 1;
      return 7;
    });
    await memo("k");
    await memo("k");
    expect(calls).toBe(1);
  });
});
