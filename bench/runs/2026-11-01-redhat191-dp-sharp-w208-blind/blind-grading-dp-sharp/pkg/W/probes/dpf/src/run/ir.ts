// PROBE-ONLY — W2-05's ir.ts signatures verbatim (briefs/W2-05.md D1); post-W2-05 site
export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };

export const irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult> =>
  Promise.resolve({ ok: true }); // PROBE-ONLY body
export const irValidate = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string }): Promise<IrResult> =>
  Promise.resolve({ ok: true }); // PROBE-ONLY body
