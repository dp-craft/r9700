import { describe, it, expect } from "vitest";
import { countWords } from "./impl";

describe("countWords", () => {
  it("should count normalized tokens when text has repeats", () => {
    const result = countWords("Hello hello, world");
    expect(result.get("hello")).toBe(2);
    expect(result.get("world")).toBe(1);
  });
  it("should return an empty map when text is empty", () => {
    expect(countWords("").size).toBe(0);
  });
});
