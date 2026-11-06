/** Shared token utilities. Tasks MUST reuse these rather than reinventing them
 *  (code-logic-writer.md: "search for an existing utility and reuse it"). */
export function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}
