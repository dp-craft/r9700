import { expect, test } from "vitest";
import { parse } from "../src/logfmt";

test("smoke", () => {
  expect(parse('a=1 b="x y" c')).toEqual({ a: "1", b: "x y", c: true });
});
