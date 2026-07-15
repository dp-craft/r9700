import { describe, it, expect } from "vitest";
import { evaluate } from "./impl";

describe("evaluate [hidden edge cases]", () => {
  it("should apply multiplication before addition when precedence differs", () => {
    const r = evaluate("2+3*4");
    expect(r.ok && r.value).toBe(14);
  });
  it("should be left-associative when subtracting repeatedly", () => {
    const r = evaluate("10-3-2");
    expect(r.ok && r.value).toBe(5);
  });
  it("should be left-associative when dividing repeatedly", () => {
    const r = evaluate("8/2/2");
    expect(r.ok && r.value).toBe(2);
  });
  it("should honor parentheses when grouping lower-precedence ops", () => {
    const r = evaluate("(2+3)*4");
    expect(r.ok && r.value).toBe(20);
  });
  it("should return an error when dividing by zero", () => {
    expect(evaluate("1/0").ok).toBe(false);
  });
  it("should return an error when parentheses are unbalanced", () => {
    expect(evaluate("(1+2").ok).toBe(false);
  });
  it("should return an error when an operator is missing its operand", () => {
    expect(evaluate("2+").ok).toBe(false);
  });
});
