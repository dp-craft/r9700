import { describe, it, expect } from "vitest";
import { scale } from "./scale";

describe("scale", () => {
  it("should scale rectangle dimensions when factor is positive", () => {
    expect(scale({ kind: "rect", width: 2, height: 3 }, 2)).toEqual({ kind: "rect", width: 4, height: 6 });
  });
});
