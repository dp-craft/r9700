import { describe, it, expect } from "vitest";
import { area } from "./area";
import { format } from "./format";
import { scale } from "./scale";
import type { Shape } from "./shape";

const tri: Shape = { kind: "triangle", base: 6, height: 4 };

describe("triangle variant [hidden]", () => {
  it("should compute triangle area when given a triangle", () => {
    expect(area(tri)).toBe(12);
  });
  it("should include 'triangle' in the label when formatting a triangle", () => {
    expect(format(tri)).toContain("triangle");
  });
  it("should scale base and height when the factor is positive", () => {
    expect(scale(tri, 2)).toEqual({ kind: "triangle", base: 12, height: 8 });
  });
  it("should return the shape unchanged when the scale factor is negative", () => {
    expect(scale(tri, -2)).toEqual(tri);
    expect(scale({ kind: "circle", radius: 3 }, -1)).toEqual({ kind: "circle", radius: 3 });
  });
});
