// PROBE-ONLY stub: the real ResidueEntrySchema (tools/shared/ir/residue.ts:37-46 at
// de110510) and FindingAnchor (tools/shared/ir/anchor.ts:13). The z refinement is not
// type-level; safeParse's union is the part the probe exercises.
export interface ResidueEntry {
  readonly class: string;
  readonly anchor: { readonly artifact: string; readonly jsonPath: string };
  readonly findingIds: readonly string[];
  readonly text: string;
  readonly dropped?: unknown;
}
export const ResidueEntrySchema: {
  safeParse(value: unknown): { readonly success: true; readonly data: ResidueEntry } | { readonly success: false };
};
