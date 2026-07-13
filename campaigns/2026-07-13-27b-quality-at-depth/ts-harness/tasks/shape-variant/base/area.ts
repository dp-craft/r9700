import { assertNever, type Shape } from "./shape";

const CIRCLE_AREA_FACTOR = Math.PI;

export function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return CIRCLE_AREA_FACTOR * shape.radius * shape.radius;
    case "rect":
      return shape.width * shape.height;
    default:
      return assertNever(shape);
  }
}
