// PROBE-ONLY stub: the real W2-05 src/run/ir.ts exports (W2-05 brief D1, lines 37-45).
export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };
export const irSet: (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }) => Promise<IrResult>;
export const irValidate: (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string }) => Promise<IrResult>;
