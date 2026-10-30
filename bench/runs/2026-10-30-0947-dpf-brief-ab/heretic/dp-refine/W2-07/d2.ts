import { requestDocRefs, refusedRef, hiddenRef, notAFileRef } from '../../../shared/request-refs.js';
import path from 'node:path';

const REFUSED_LEAD = 'refused (outside the project root): ';
const HIDDEN_LEAD = 'refused (hidden file): ';
const NO_CONTENT_LEAD = 'no content (missing, empty or unreadable): ';
const NOT_A_FILE_LEAD = 'not read (names no file — a document ref carries its extension): ';
const BARE_FILE_RE = /\.[\p{L}\p{N}_-]+$/u;

export interface PreflightFsDeps {
  readonly exists: (full: string) => boolean;
  readonly size: (full: string) => number;
}

export const preflightLines = (text: string, root: string, fsDeps: PreflightFsDeps): { lines: string[]; blocking: boolean } => {
  const lines: string[] = [];
  let blocking = false;
  for (const ref of requestDocRefs(text)) {
    const full = path.join(root, ref);
    if (refusedRef(ref)) { lines.push(`${REFUSED_LEAD}${ref}`); blocking = true; }
    else if (hiddenRef(ref)) { lines.push(`${HIDDEN_LEAD}${ref}`); blocking = true; }
    else if (notAFileRef(ref)) { lines.push(`${NOT_A_FILE_LEAD}${ref}`); blocking = true; }
    else if (fsDeps.exists(full)) { lines.push(`${ref} (${Math.round(fsDeps.size(full) / 1024)} KB)`); }
    else { lines.push(`${NO_CONTENT_LEAD}${ref}`); blocking = true; }
  }
  for (const token of text.split(/\s+/)) {
    if (token.startsWith('@')) continue;
    const bare = token.replace(/^[.,;:!?]+/, '').replace(/[.,;:!?]+$/, '');
    if (bare.includes('/') && BARE_FILE_RE.test(bare) && fsDeps.exists(path.join(root, bare))) {
      lines.push(`warn: ${bare} names an existing file (no @)`);
    }
  }
  return { lines, blocking };
};
