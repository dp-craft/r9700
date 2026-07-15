import { normalizeToken } from "../../lib/tokenize";

export function countWords(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const raw of text.split(/\s+/)) {
    const token = normalizeToken(raw);
    if (token.length === 0) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
