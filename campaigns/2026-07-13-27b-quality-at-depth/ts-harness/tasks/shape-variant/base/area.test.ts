import { describe, it, expect } from "vitest";
import { area } from "./area";

describe("area", () => {
  it("should compute rectangle area when given a rect", () => {
    expect(area({ kind: "rect", width: 3, height: 4 })).toBe(12);
  });
});
