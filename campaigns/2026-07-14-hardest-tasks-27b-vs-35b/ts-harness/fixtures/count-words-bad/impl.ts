export function countWords(text: any) {
  const counts: any = {};
  const parts = text.split(" ");
  for (let i = 0; i < parts.length; i++) {
    let w = parts[i].toLowerCase();
    let clean = "";
    for (let j = 0; j < w.length; j++) {
      const c = w[j];
      if (c >= "a" && c <= "z") clean += c;
      else if (c >= "0" && c <= "9") clean += c;
    }
    if (clean.length > 0) {
      if (counts[clean]) counts[clean] = counts[clean] + 1;
      else counts[clean] = 1;
    }
  }
  return counts;
}
