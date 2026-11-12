import { describe, it, expect } from "vitest";
import { countWords } from "./impl";

describe("countWords", () => {
  it("should count tokens when they repeat", () => {
    expect(countWords("a a b")).toEqual({ a: 2, b: 1 });
  });
});
