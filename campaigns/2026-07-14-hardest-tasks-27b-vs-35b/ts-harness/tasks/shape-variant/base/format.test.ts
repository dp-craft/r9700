import { describe, it, expect } from "vitest";
import { format } from "./format";

describe("format", () => {
  it("should render a circle when given a circle", () => {
    expect(format({ kind: "circle", radius: 2 })).toBe("circle(r=2)");
  });
});
