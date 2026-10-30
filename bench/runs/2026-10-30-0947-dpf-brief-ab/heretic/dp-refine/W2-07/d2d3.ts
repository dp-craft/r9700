import path from 'node:path';

// PROBE-ONLY stubs for the not-yet-created modules
type RefPredicate = (ref: string) => boolean;
const REFUSED_LEAD = 'refused (outside the project root): ';
const HIDDEN_LEAD = 'refused (hidden file): ';
const NO_CONTENT_LEAD = 'no content (missing, empty or unreadable): ';
const NOT_A_FILE_LEAD = 'not read (names no file — a document ref carries its extension): ';
const refusedRef: RefPredicate = ref => !ref.includes('/');
const hiddenRef: RefPredicate = ref => ref.startsWith('.');
const notAFileRef: RefPredicate = ref => !ref.includes('.');
const requestDocRefs = (text: string): readonly string[] => text.split(' ').filter(t => t.startsWith('@')).map(t => t.slice(1));
interface Screen<S, R> { readonly start: { readonly state: S; readonly out: readonly string[] }; readonly next: (state: S, line: string) => { readonly state: S; readonly out: readonly string[]; readonly result?: R } }
type PreflightResult = 'continue' | 'edit' | 'quit';

const KB = 1024;
const BARE_FILE_RE = /\.[\p{L}\p{N}_-]+$/u;
const EDGE_PUNCTUATION_RE = /^[.,;:!?]+|[.,;:!?]+$/gu;
const CONTINUE_PROMPT = 'c to continue, e to edit request.txt, q to quit';
const BLOCKED_PROMPT = 'e to edit request.txt, q to quit';

export interface PreflightFsDeps {
  readonly exists: (full: string) => boolean;
  readonly size: (full: string) => number;
}

interface RefLine {
  readonly line: string;
  readonly blocking: boolean;
}

const UNREAD: readonly (readonly [(ref: string) => boolean, string])[] = [
  [refusedRef, REFUSED_LEAD],
  [hiddenRef, HIDDEN_LEAD],
  [notAFileRef, NOT_A_FILE_LEAD],
];

const refLine = (ref: string, root: string, fsDeps: PreflightFsDeps): RefLine => {
  const unread = UNREAD.find(([test]) => test(ref));
  if (unread !== undefined) return { line: `${unread[1]}${ref}`, blocking: true };
  const full = path.join(root, ref);
  return fsDeps.exists(full) && fsDeps.size(full) > 0
    ? { line: `${ref} (${String(Math.round(fsDeps.size(full) / KB))} KB)`, blocking: false }
    : { line: `${NO_CONTENT_LEAD}${ref}`, blocking: true };
};

const bareWarnings = (text: string, root: string, fsDeps: PreflightFsDeps): readonly string[] =>
  [...new Set(text.split(/\s+/u).filter(token => !token.startsWith('@')).map(token => token.replace(EDGE_PUNCTUATION_RE, '')))]
    .filter(bare => bare.includes('/') && BARE_FILE_RE.test(bare) && fsDeps.exists(path.join(root, bare)))
    .map(bare => `warn: ${bare} names an existing file (no @)`);

export const preflightLines = (
  text: string,
  root: string,
  fsDeps: PreflightFsDeps
): { lines: string[]; blocking: boolean } => {
  const refs = requestDocRefs(text).map(ref => refLine(ref, root, fsDeps));
  return {
    lines: [...refs.map(entry => entry.line), ...bareWarnings(text, root, fsDeps)],
    blocking: refs.some(entry => entry.blocking),
  };
};

const KEYS: Readonly<Record<string, PreflightResult>> = { c: 'continue', e: 'edit', q: 'quit' };

const promptFor = (blocking: boolean): string => (blocking ? BLOCKED_PROMPT : CONTINUE_PROMPT);

const resultFor = (line: string, blocking: boolean): PreflightResult | undefined => {
  const result = KEYS[line];
  return blocking && result === 'continue' ? undefined : result;
};

export const preflightScreen = (lines: readonly string[], blocking: boolean): Screen<boolean, PreflightResult> => ({
  start: { state: blocking, out: [...lines, promptFor(blocking)] },
  next: (state, line) => {
    const result = resultFor(line, state);
    return result === undefined ? { state, out: [...lines, promptFor(state)] } : { state, out: [], result };
  },
});
