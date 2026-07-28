export function countWords(text: string) {
  const counts: Record<string, number> = {};
  for (const raw of text.split(/\s+/)) {
    const token = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (token.length === 0) continue;
    counts[token] = (counts[token] ?? 0) + 1;
  }
  return counts;
}
