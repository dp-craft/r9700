import { countWords } from "./impl";

test("works", () => {
  const spy = jest.fn();
  expect(countWords("a a b")).toEqual({ a: 2, b: 1 });
});
