export type IrResult = { readonly ok: true } | { readonly ok: false; readonly file: string; readonly findings: string | undefined; readonly error: string | undefined };
export const irSet = (o: { readonly cli: readonly string[]; readonly kind: string; readonly file: string; readonly path: string; readonly value: unknown }): Promise<IrResult> => Promise.resolve({ ok: true });
