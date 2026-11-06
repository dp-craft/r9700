import { assertNever, type Shape } from "./shape";

export function format(shape: Shape): string {
  switch (shape.kind) {
    case "circle":
      return `circle(r=${String(shape.radius)})`;
    case "rect":
      return `rect(${String(shape.width)}x${String(shape.height)})`;
    default:
      return assertNever(shape);
  }
}
