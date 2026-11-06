import { assertNever, type Shape } from "./shape";

export function scale(shape: Shape, factor: number): Shape {
  switch (shape.kind) {
    case "circle":
      return { kind: "circle", radius: shape.radius * factor };
    case "rect":
      return { kind: "rect", width: shape.width * factor, height: shape.height * factor };
    default:
      return assertNever(shape);
  }
}
