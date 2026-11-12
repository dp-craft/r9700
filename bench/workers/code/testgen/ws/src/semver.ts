export interface SemVer { major: number; minor: number; patch: number; pre: string[] }
export class SemVerError extends Error {}
const RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parse(s: string): SemVer {
  const m = RE.exec(s);
  if (!m) throw new SemVerError(`invalid version: ${s}`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { major, minor, patch, pre: m[4] ? m[4].split(".") : [] };
}

function cmpIdent(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an) return -1;
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: returns -1, 0 or 1. A prerelease sorts before its release. */
export function compare(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (const k of ["major", "minor", "patch"] as const) {
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  const n = Math.min(x.pre.length, y.pre.length);
  for (let i = 0; i < n; i++) {
    const c = cmpIdent(x.pre[i] as string, y.pre[i] as string);
    if (c !== 0) return c;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** Caret range: ^1.2.3 allows <2.0.0, ^0.2.3 allows <0.3.0, ^0.0.3 allows only 0.0.3. Prereleases need the same x.y.z as base. */
export function satisfiesCaret(version: string, base: string): boolean {
  const v = parse(version);
  const b = parse(base);
  if (v.pre.length > 0 && !(v.major === b.major && v.minor === b.minor && v.patch === b.patch)) return false;
  if (compare(version, base) < 0) return false;
  if (b.major > 0) return v.major === b.major;
  if (b.minor > 0) return v.major === 0 && v.minor === b.minor;
  return v.major === 0 && v.minor === 0 && v.patch === b.patch;
}

/** Next version. Lower parts reset to 0 and any prerelease is dropped. */
export function bump(version: string, part: "major" | "minor" | "patch"): string {
  const v = parse(version);
  if (part === "major") return `${v.major + 1}.0.0`;
  if (part === "minor") return `${v.major}.${v.minor + 1}.0`;
  return `${v.major}.${v.minor}.${v.patch + 1}`;
}

/** Highest version in the list, or null when it is empty. */
export function maxVersion(list: readonly string[]): string | null {
  let best: string | null = null;
  for (const s of list) {
    if (best === null || compare(s, best) > 0) best = s;
  }
  return best;
}
