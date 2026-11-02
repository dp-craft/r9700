/**
 * The IR path grammar, deliberately tiny: `$` root, `.key`, `[n]` array index, `[id=<value>]`
 * array element whose `id` field equals `<value>`.
 *
 * Both array forms exist because they fail differently. A reviser that miscounts an index
 * silently patches the WRONG requirement and nothing detects it; an `[id=...]` selector is
 * checkable — it either matches exactly one row or it errors. Emitters SHOULD emit the id
 * form; the index form stays for insert positions and for arrays whose rows carry no id.
 */
export type Segment =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'id'; readonly id: string };

export type PathParse =
  | { readonly ok: true; readonly segments: readonly Segment[] }
  | { readonly ok: false; readonly error: string };

const SEGMENT_RE = /\.([A-Za-z0-9_$-]+)|\[([^\]]*)\]/gu;

export const segLabel = (seg: Segment): string =>
  seg.kind === 'key' ? `.${seg.key}` : seg.kind === 'index' ? `[${seg.index}]` : `[id=${seg.id}]`;

const bracketSegment = (raw: string): Segment | null => {
  const idMatch = /^id=(.+)$/u.exec(raw);
  if (idMatch?.[1] !== undefined) return { kind: 'id', id: idMatch[1] };
  return /^\d+$/u.test(raw) ? { kind: 'index', index: Number(raw) } : null;
};

const toSegment = (match: RegExpMatchArray): Segment | null =>
  match[1] === undefined ? bracketSegment(match[2] ?? '') : { kind: 'key', key: match[1] };

const segmentsOf = (path: string, matches: readonly RegExpMatchArray[]): PathParse => {
  const segments = matches.map(toSegment);
  const badAt = segments.findIndex(segment => segment === null);
  if (badAt >= 0) return { ok: false, error: `path ${path} has an unparseable segment ${matches[badAt]?.[0] ?? ''}` };
  return { ok: true, segments: segments.filter((segment): segment is Segment => segment !== null) };
};

/** The bare `$` addresses the whole document and parses to zero segments. */
export const parsePath = (path: string): PathParse => {
  if (!path.startsWith('$')) return { ok: false, error: `path ${path} must start with $` };
  const matches = [...path.slice(1).matchAll(SEGMENT_RE)];
  const consumed = matches.reduce((total, match) => total + match[0].length, 0);
  return consumed === path.length - 1 ? segmentsOf(path, matches) : { ok: false, error: `path ${path} is unparseable` };
};

/** One step of a built path: a `.key`, a `[n]` index, or an `[id=...]` selector. */
export type JsonPathSegment = string | number | { readonly id: string };

const jsonPathSegment = (seg: JsonPathSegment): string =>
  typeof seg === 'string' ? `.${seg}` : typeof seg === 'number' ? `[${seg}]` : `[id=${seg.id}]`;

/** The inverse of `parsePath`: build a path from its segments. */
export const jsonPath = (...segs: readonly JsonPathSegment[]): string =>
  `$${segs.map(jsonPathSegment).join('')}`;

/**
 * The id-form locator for one row of an IR array, with the index fallback: when the id is not
 * representable in the path grammar (it holds a `]`, e.g. "[FR-001]"), emit the index form and
 * carry the raw id in `ref` so the finding stays machine-checkable instead of failing the
 * findings document's locator validation. An empty id has nothing to carry in `ref`.
 */
export const idLocator = (
  collection: string,
  id: string,
  index: number,
  field?: string
): { readonly locator: string; readonly ref?: string } => {
  const tail = field === undefined ? [] : [field];
  const byId = jsonPath(collection, { id }, ...tail);
  if (parsePath(byId).ok) return { locator: byId };
  return { locator: jsonPath(collection, index, ...tail), ...(id === '' ? {} : { ref: id }) };
};
