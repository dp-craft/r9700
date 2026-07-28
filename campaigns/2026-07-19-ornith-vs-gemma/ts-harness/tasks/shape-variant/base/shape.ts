export type Shape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "rect"; readonly width: number; readonly height: number };

export function assertNever(x: never): never {
  throw new Error(`unhandled shape: ${JSON.stringify(x)}`);
}
