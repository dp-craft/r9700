export class LogfmtError extends Error {
  public readonly column: number;
  constructor(message: string, column: number) { super(message); this.column = column; }
}
const isWs = (c: string | undefined): boolean => c === " " || c === "\t";
export function parse(line: string): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  let i = 0;
  while (i < line.length) {
    while (isWs(line[i])) i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && !isWs(line[i]) && line[i] !== "=") i++;
    const key = line.slice(start, i);
    if (key === "") throw new LogfmtError("empty key", i);
    if (line[i] !== "=") { out[key] = true; continue; }
    i++;
    if (line[i] === '"') {
      const open = i;
      i++;
      let v = "";
      let closed = false;
      while (i < line.length) {
        const c = line[i];
        if (c === "\\") {
          const n = line[i + 1];
          if (n === '"') v += '"'; else if (n === "\\") v += "\\"; else if (n === "n") v += "\n";
          else throw new LogfmtError("bad escape", i);
          i += 2;
        } else if (c === '"') { closed = true; i++; break; } else { v += c; i++; }
      }
      if (!closed) throw new LogfmtError("unterminated", open);
      if (i < line.length && !isWs(line[i])) throw new LogfmtError("junk after quote", i);
      out[key] = v;
    } else {
      const s = i;
      while (i < line.length && !isWs(line[i])) i++;
      out[key] = line.slice(s, i);
    }
  }
  return out;
}
export function format(fields: Record<string, string | true>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "" || /[ \t="]/.test(k)) throw new LogfmtError("bad key", -1);
    if (v === true) { parts.push(k); continue; }
    if (v === "" || /[ \t"\\=\n]/.test(v)) {
      parts.push(`${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
    } else parts.push(`${k}=${v}`);
  }
  return parts.join(" ");
}
