// PROBE-ONLY: src/run/ir.ts exports as W2-05's brief D1 leaves them (post-W2-05 predecessor stub).
export type IrResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };

export type IrDiffResult =
  | { readonly ok: true; readonly lines: string[] }
  | { readonly ok: false; readonly error: string };

export const irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult> => {
  void o;
  return Promise.reject(new Error('PROBE-ONLY'));
};

export const irValidate = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string }): Promise<IrResult> => {
  void o;
  return Promise.reject(new Error('PROBE-ONLY'));
};

export const irDiff = (o: { readonly cli: readonly string[]; readonly kind: string; readonly a: string; readonly b: string }): Promise<IrDiffResult> => {
  void o;
  return Promise.reject(new Error('PROBE-ONLY'));
};
