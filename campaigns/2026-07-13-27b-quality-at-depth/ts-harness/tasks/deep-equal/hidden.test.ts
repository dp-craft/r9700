import { describe, it, expect } from "vitest";
import { deepEqual } from "./impl";

describe("deepEqual [hidden edge cases]", () => {
  it("should treat NaN as equal to NaN when both are NaN", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
  it("should compare nested arrays structurally when the values match", () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
  });
  it("should return false when one object has an extra key", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it("should distinguish an array from a plain object when shapes differ", () => {
    expect(deepEqual([1], { 0: 1 })).toBe(false);
  });
  it("should return false when primitive types differ", () => {
    expect(deepEqual(1, "1")).toBe(false);
  });
  it("should return false when comparing null to an empty object", () => {
    expect(deepEqual(null, {})).toBe(false);
  });
});
