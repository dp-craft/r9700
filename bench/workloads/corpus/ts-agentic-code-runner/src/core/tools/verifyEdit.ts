import { readFile, stat, writeFile } from 'node:fs/promises';

import type { ToolResult } from '../shared';

export interface VerifyEditArgs {
  readonly path: string;
  readonly anchor: string;
  readonly replacement: string;
}

const countOccurrences = (haystack: string, needle: string): number =>
  needle.length === 0 ? 0 : haystack.split(needle).length - 1;

const reject = (output: string): ToolResult => ({ ok: false, output });

const alreadyAppliedMessage = (path: string): string =>
  `verify_edit: replacement already applied at anchor (no-op duplicate): ${path}`;

const isReapplication = (content: string, anchor: string, replacement: string): boolean => {
  if (!replacement.includes(anchor)) {
    return false;
  }
  const blockStart = content.indexOf(anchor) - replacement.indexOf(anchor);
  return blockStart >= 0 && content.startsWith(replacement, blockStart);
};

// Normalize for fuzzy matching: strip leading whitespace per line, collapse internal runs.
const normalizeLine = (line: string): string =>
  line.replace(/^[\t ]+/, '').replace(/[\t ]+/g, ' ');

const normalizeWhitespace = (text: string): string =>
  text.split('\n').map(normalizeLine).join('\n');

// Internal result for fuzzy match that carries the new content when successful.
interface FuzzyResult {
  readonly ok: boolean;
  readonly output: string;
  readonly content?: string;
  readonly appliedAtLine?: number;
}

// Scan lines to find the raw offset corresponding to a normalized offset within
// a single line. Returns rawLineOffset (0-based from start of line).
const rawOffsetInLine = (rawLine: string, normTarget: number): number => {
  const leadSkip = rawLine.length - rawLine.replace(/^[\t ]+/, '').length;
  if (normTarget === 0) return leadSkip;
  return rawLine.split('').reduce(
    (acc, ch, rawIdx) => {
      if (acc.done || rawIdx < leadSkip) return acc;
      if (acc.normCount >= normTarget) return { ...acc, done: true };
      const isWs = ch === ' ' || ch === '\t';
      if (isWs) {
        // Only count first ws char in a run; subsequent ones are consumed silently.
        const prevCh = rawLine[rawIdx - 1];
        const prevIsWs = prevCh === ' ' || prevCh === '\t';
        const isFirstInRun = rawIdx === leadSkip || !prevIsWs;
        return isFirstInRun
          ? { rawIdx: rawIdx + 1, normCount: acc.normCount + 1, done: false }
          : { ...acc, rawIdx: rawIdx + 1 };
      }
      return { rawIdx: rawIdx + 1, normCount: acc.normCount + 1, done: false };
    },
    { rawIdx: leadSkip, normCount: 0, done: false }
  ).rawIdx;
};

// Map a normalized position (normStart, normEnd) back to raw positions across lines.
interface RawSpan {
  readonly rawStart: number;
  readonly rawEnd: number;
}

const normToRawSpan = (
  rawLines: readonly string[],
  normLines: readonly string[],
  normStart: number,
  normEnd: number
): RawSpan | null => {
  const result = rawLines.reduce(
    (acc, rawLine, li) => {
      if (acc.rawStart !== -1 && acc.rawEnd !== -1) return acc;
      const normLine = normLines[li] ?? '';
      const lineNormEnd = acc.normOff + normLine.length;

      const rawStart =
        acc.rawStart === -1 && normStart >= acc.normOff && normStart <= lineNormEnd
          ? acc.rawOff + rawOffsetInLine(rawLine, normStart - acc.normOff)
          : acc.rawStart;

      const rawEnd =
        rawStart !== -1 &&
        acc.rawEnd === -1 &&
        normEnd >= acc.normOff &&
        normEnd <= lineNormEnd + 1
          ? acc.rawOff +
            rawOffsetInLine(rawLine, Math.min(normEnd - acc.normOff, normLine.length))
          : acc.rawEnd;

      return {
        rawOff: acc.rawOff + rawLine.length + 1,
        normOff: acc.normOff + normLine.length + 1,
        rawStart,
        rawEnd,
      };
    },
    { rawOff: 0, normOff: 0, rawStart: -1, rawEnd: -1 }
  );
  return result.rawStart === -1 || result.rawEnd === -1 ? null : result;
};

const tryNormalizedMatch = (content: string, anchor: string, replacement: string): FuzzyResult => {
  const normContent = normalizeWhitespace(content);
  const normAnchor = normalizeWhitespace(anchor);
  const count = countOccurrences(normContent, normAnchor);

  if (count === 0) {
    return { ok: false, output: `edit: anchor not found (exact and whitespace-normalized)` };
  }
  if (count > 1) {
    return {
      ok: false,
      output: `edit: anchor matches ${count} regions — add more surrounding context`,
    };
  }

  const normStart = normContent.indexOf(normAnchor);
  const normEnd = normStart + normAnchor.length;
  const rawLines = content.split('\n');
  const normLines = normContent.split('\n');
  const span = normToRawSpan(rawLines, normLines, normStart, normEnd);

  if (span === null) {
    return { ok: false, output: `edit: anchor not found (exact and whitespace-normalized)` };
  }

  const rawSlice = content.slice(span.rawStart, span.rawEnd);
  if (normalizeWhitespace(rawSlice) !== normAnchor) {
    return {
      ok: false,
      output: `edit: anchor not found (whitespace-normalized span re-verification failed)`,
    };
  }

  const appliedAtLine = content.slice(0, span.rawStart).split('\n').length;
  const next = content.slice(0, span.rawStart) + replacement + content.slice(span.rawEnd);
  return { ok: true, output: '', content: next, appliedAtLine };
};

const tokenize = (line: string): readonly string[] =>
  line
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 0);

const firstNonEmptyLine = (anchor: string): string =>
  anchor.split('\n').find(line => line.trim().length > 0) ?? '';

interface RankedLine {
  readonly lineNo: number;
  readonly line: string;
  readonly score: number;
}

const NEAREST_LINE_LIMIT = 3;

const rankLinesByOverlap = (content: string, anchor: string): readonly RankedLine[] => {
  const anchorTokens = new Set(tokenize(firstNonEmptyLine(anchor)));
  if (anchorTokens.size === 0) {
    return [];
  }
  return content
    .split('\n')
    .map((line, idx): RankedLine => ({
      lineNo: idx + 1,
      line,
      score: tokenize(line).filter(token => anchorTokens.has(token)).length,
    }))
    .filter(ranked => ranked.score > 0)
    .sort((a, b) => b.score - a.score || a.lineNo - b.lineNo)
    .slice(0, NEAREST_LINE_LIMIT);
};

const recoveryHintHeader =
  'edit: anchor not found. Closest existing lines — copy one VERBATIM ' +
  '(with enough surrounding lines to be unique) as your anchor:';

export type ContentReader = (path: string) => Promise<string>;

const defaultReader: ContentReader = path => readFile(path, 'utf8');

export const buildAnchorRecoveryHint = async (
  path: string,
  anchor: string,
  fallback: string,
  read: ContentReader = defaultReader
): Promise<string> => {
  const content = await read(path).catch(() => null);
  if (content === null) {
    return fallback;
  }
  const ranked = rankLinesByOverlap(content, anchor);
  if (ranked.length === 0) {
    return fallback;
  }
  const lines = ranked.map(({ lineNo, line }) => `${path}:${lineNo}: ${line}`).join('\n');
  return `${recoveryHintHeader}\n${lines}`;
};

const isNotFound = (output: string): boolean => output.includes('not found');

const applyAndWrite = async (
  filePath: string,
  next: string,
  appliedAtLine?: number
): Promise<ToolResult> => {
  await writeFile(filePath, next, 'utf8');
  const lineInfo = appliedAtLine !== undefined ? ` (fuzzy match at line ${appliedAtLine})` : '';
  return { ok: true, output: `verify_edit: applied edit to ${filePath}${lineInfo}` };
};

export async function verifyEdit(args: VerifyEditArgs): Promise<ToolResult> {
  const stats = await stat(args.path).catch(() => null);
  if (stats === null || !stats.isFile()) {
    return reject(`verify_edit: path is not a readable file: ${args.path}`);
  }

  const content = await readFile(args.path, 'utf8');
  const occurrences = countOccurrences(content, args.anchor);

  if (occurrences > 1) {
    return reject(`verify_edit: anchor ambiguous (${occurrences} matches) in ${args.path}`);
  }

  if (occurrences === 0) {
    const fuzzy = tryNormalizedMatch(content, args.anchor, args.replacement);
    if (!fuzzy.ok || fuzzy.content === undefined) {
      const output = isNotFound(fuzzy.output)
        ? await buildAnchorRecoveryHint(args.path, args.anchor, fuzzy.output, () =>
            Promise.resolve(content)
          )
        : fuzzy.output;
      return reject(output);
    }
    return applyAndWrite(args.path, fuzzy.content, fuzzy.appliedAtLine);
  }

  if (isReapplication(content, args.anchor, args.replacement)) {
    return reject(alreadyAppliedMessage(args.path));
  }

  const next = content.replace(args.anchor, args.replacement);
  return applyAndWrite(args.path, next);
}
