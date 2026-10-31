// PROBE-ONLY stub: mirrors W2-05 exports for tools/dpf/src/run/ir.ts.
export interface IrResult { readonly ok: boolean; readonly findings: readonly string[]; readonly error?: string }
const ok = { ok: true, findings: [] as readonly string[] } satisfies IrResult;
export const irSet = (o: { cli: readonly string[]; kind: string; file: string; path: string; value: unknown }): Promise<IrResult> => {
  const _ = o;
  return Promise.resolve(ok);
};
export const irValidate = (o: { cli: readonly string[]; file: string }): Promise<IrResult> => {
  const _ = o;
  return Promise.resolve(ok);
};
