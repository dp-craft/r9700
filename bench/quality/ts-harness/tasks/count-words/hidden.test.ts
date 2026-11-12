import { describe, it, expect } from "vitest";
import { countWords } from "./impl";

describe("countWords [hidden edge cases]", () => {
  it("should return an empty map when text is only punctuation", () => {
    expect(countWords("!!! ... ???").size).toBe(0);
  });
  it("should merge tokens case-insensitively when case differs", () => {
    expect(countWords("Go GO go").get("go")).toBe(3);
  });
});
