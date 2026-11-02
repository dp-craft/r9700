// PROBE-ONLY stub of tools/dpf/src/run/ir.ts (W2-05 D1): signatures verbatim, bodies stubbed.
export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };
export type IrDiffResult =
  | { readonly ok: true; readonly lines: string[] }
  | { readonly ok: false; readonly error: string };
export const irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult> => Promise.resolve({ ok: true });
export const irValidate = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string }): Promise<IrResult> => Promise.resolve({ ok: true });
export const irDiff = (o: { readonly cli: readonly string[]; readonly kind: string; readonly a: string; readonly b: string }): Promise<IrDiffResult> => Promise.resolve({ ok: true, lines: [] });
