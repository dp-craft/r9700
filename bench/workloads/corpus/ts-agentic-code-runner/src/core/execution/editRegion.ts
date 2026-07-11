import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ENV } from '../shared';
import type { TaskSpec } from './executor';
import { sliceSymbol, type SymbolSlice } from './regionSlicer';
import type { RegionStore } from './regionStore';

// ─── constants ───────────────────────────────────────────────────────────────

const DEFAULT_LARGE_FILE_LINES = 300;
const LARGE_FILE_LINES_ENV = ENV.LARGE_FILE_LINES;
const LARGE_FILE_LINES_LEGACY_ENV = 'RUNNER_MAX_WHOLE_WRITE_LINES';
const MAX_EXPORT_NAMES = 30;

export const MAX_TEST_PRELOAD_LINES = 200;
export const TARGET_TAIL_LINES = 40;
export const MAX_TEST_PRELOAD_CHARS = 8000;
export const MAX_PRELOAD_FILE_CHARS = 80000;

// ─── env resolver (single owner for the large-file threshold) ────────────────
// Reads RUNNER_LARGE_FILE_LINES first; falls back to the legacy
// RUNNER_MAX_WHOLE_WRITE_LINES alias. Treats undefined, empty-string, and NaN
// as the 300-line default (Number('') === 0, which must not win).

export const resolveLargeFileLines = (): number => {
  const canonical = process.env[LARGE_FILE_LINES_ENV];
  const raw =
    canonical !== undefined && canonical !== ''
      ? canonical
      : process.env[LARGE_FILE_LINES_LEGACY_ENV];
  if (raw === undefined || raw === '') return DEFAULT_LARGE_FILE_LINES;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? DEFAULT_LARGE_FILE_LINES : parsed;
};

// ─── types ───────────────────────────────────────────────────────────────────

export type FileReader = (path: string) => Promise<string | null>;

interface NavBundle {
  readonly apiContracts?: readonly { readonly name?: string }[];
  readonly collaborators?: {
    readonly siblingBody?: { readonly name?: string } | null;
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const defaultReader: FileReader = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

const countLines = (text: string): number => text.split('\n').length;

const extractExportNames = (text: string): readonly string[] =>
  text
    .split('\n')
    .filter(line => /^export /.test(line))
    .map(line => {
      const m =
        line.match(/^export (?:const|function|class|type|interface|enum|async function) (\w+)/) ??
        line.match(/^export \{ ([^}]+) \}/);
      if (!m) return null;
      return m[1].split(',')[0].trim();
    })
    .filter((name): name is string => name !== null)
    .slice(0, MAX_EXPORT_NAMES);

const parseNavBundle = (text: string): NavBundle | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') return parsed as NavBundle;
    return null;
  } catch {
    return null;
  }
};

const extractApiContractNames = (bundle: NavBundle): readonly string[] =>
  (bundle.apiContracts ?? [])
    .map(c => c.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

const buildFileParagraph = (
  filePath: string,
  lineCount: number,
  exports: readonly string[],
  surface: readonly string[]
): string => {
  const exportLine =
    exports.length > 0
      ? `Existing exports (already present — extend, do not duplicate or remove): ${exports.join(', ')}.`
      : 'No top-level exports detected yet.';
  const surfaceLine =
    surface.length > 0 ? `New or changed surface to add: ${surface.join(', ')}.` : '';
  const lines = [
    `File: ${filePath} (${lineCount} lines — large file).`,
    `Use the edit tool with a unique anchor to insert or replace only the changed region; leave all other code byte-for-byte unchanged. Do NOT use the write tool to rewrite the whole file.`,
    exportLine,
    ...(surfaceLine ? [surfaceLine] : []),
    `Implement exactly what the failing test requires and nothing more.`,
  ];
  return lines.join(' ');
};

// ─── public API ──────────────────────────────────────────────────────────────

export const buildEditRegionDirective = async (
  spec: TaskSpec,
  read: FileReader = defaultReader
): Promise<string> => {
  const threshold = resolveLargeFileLines();

  const fileTexts = await Promise.all(
    spec.targetFiles.map(async (filePath): Promise<{ filePath: string; text: string | null }> => ({
      filePath,
      text: await read(filePath),
    }))
  );

  const largeFiles = fileTexts.filter(
    ({ text }) => text !== null && countLines(text) >= threshold
  ) as ReadonlyArray<{ filePath: string; text: string }>;

  if (largeFiles.length === 0) return '';

  const navText = await read(spec.navBundlePath);
  const bundle = navText !== null ? (parseNavBundle(navText) ?? {}) : {};
  const surface = extractApiContractNames(bundle);

  const paragraphs = largeFiles.map(({ filePath, text }) =>
    buildFileParagraph(filePath, countLines(text), extractExportNames(text), surface)
  );

  return `\n\nLarge-file edit guidance:\n${paragraphs.join('\n\n')}`;
};

// ─── buildImplPreload helpers ─────────────────────────────────────────────────

const clipText = (text: string): string =>
  text.length > MAX_TEST_PRELOAD_CHARS ? text.slice(0, MAX_TEST_PRELOAD_CHARS) + '…[clipped]' : text;

const tailLines = (text: string, count: number): string =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .slice(-count)
    .join('\n');

const truncateTestFile = (text: string): string => {
  const lines = text.split('\n');
  if (lines.length <= MAX_TEST_PRELOAD_LINES) return text;
  const tail = lines.slice(-MAX_TEST_PRELOAD_LINES).join('\n');
  return `… (earlier tests omitted — read the test file if the case you need isn't shown)\n${tail}`;
};

const buildTestSection = async (
  paths: readonly string[],
  read: FileReader
): Promise<string | null> => {
  const texts = await Promise.all(paths.map(p => read(p)));
  const present = texts.filter((t): t is string => t !== null).map(truncateTestFile);
  if (present.length === 0) return null;
  const combined = clipText(present.join('\n\n'));
  return `Failing test source (implement to satisfy these assertions — you do NOT need to read the test file):\n${combined}`;
};

const formatTailSection = (text: string): string => {
  const tail = tailLines(text, TARGET_TAIL_LINES);
  return `Target file tail — construct a unique multi-line edit anchor from real lines like these (do NOT read the whole file just to anchor):\n${tail}`;
};

const buildTargetSection = async (
  targetPath: string,
  read: FileReader
): Promise<string | null> => {
  const text = await read(targetPath);
  if (text === null) return null;
  if (text.length > MAX_PRELOAD_FILE_CHARS) return formatTailSection(text);
  return `Full current source of ${targetPath} (authoritative — do NOT re-read it; edit it):\n${text}`;
};

// ─── slice-region preload (3.2) ───────────────────────────────────────────────

export type SliceResolver = (filePath: string, symbolName: string) => SymbolSlice | null;

export interface PreloadOptions {
  readonly regionStore?: RegionStore;
  readonly slice?: SliceResolver;
}

// A replace-slice targets an EXISTING symbol (modify tasks, or add-tasks on retry
// once the new member exists). A neighbor-slice targets the nearest existing sibling
// as an INSERT anchor — the model keeps it and appends the new member after it.
type SliceKind = 'symbol' | 'neighbor';

interface SliceInput {
  readonly slice: SymbolSlice;
  readonly exports: readonly string[];
  readonly kind: SliceKind;
  readonly anchorName: string;
}

// The symbol the task creates/changes, parsed from the task statement's first
// back-ticked call-form identifier (e.g. "Add `runEvalComparison(runId)` to …" →
// runEvalComparison). This lets an add-a-new-member task resolve to a replace-slice
// of that member ONCE it exists — the retry-safety hinge: attempt 1 inserts via the
// neighbor anchor (the symbol is absent), later attempts refine the now-present
// member in place instead of inserting a duplicate.
const parseDeliverableName = (taskStatement: string | undefined): string | null => {
  if (taskStatement === undefined) return null;
  const m = taskStatement.match(/`([A-Za-z_$][\w$]*)\s*\(/);
  return m === null ? null : m[1];
};

const siblingAnchorName = (bundle: NavBundle | null): string | null => {
  const name = bundle?.collaborators?.siblingBody?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
};

// First name in `names` that the slicer resolves to a real span, or null. Candidates
// are ≤2 (an apiContract + the parsed deliverable), so eager mapping is cheap.
const firstSlice = (
  names: readonly string[],
  targetPath: string,
  sliceFn: SliceResolver
): { readonly name: string; readonly slice: SymbolSlice } | null =>
  names
    .map(name => ({ name, slice: sliceFn(targetPath, name) }))
    .find((r): r is { name: string; slice: SymbolSlice } => r.slice !== null) ?? null;

// Resolve the authorized slice for a large target. Priority:
//   1. an EXISTING symbol named by apiContracts or by the task's deliverable →
//      replace-slice of that symbol;
//   2. else the nearest sibling member (collaborators.siblingBody) → neighbor
//      insert anchor.
// Returns null (→ full-source fallback) when nothing resolves.
const resolveSlice = async (
  spec: TaskSpec,
  targetPath: string,
  read: FileReader,
  sliceFn: SliceResolver
): Promise<SliceInput | null> => {
  const text = await read(targetPath);
  if (text === null || countLines(text) < resolveLargeFileLines()) return null;
  const navText = await read(spec.navBundlePath);
  const bundle = navText === null ? null : parseNavBundle(navText);
  const exports = extractExportNames(text);
  const deliverable = parseDeliverableName(spec.taskStatement);
  const symbolNames = [
    ...(bundle === null ? [] : extractApiContractNames(bundle)),
    ...(deliverable === null ? [] : [deliverable]),
  ];
  const symbolHit = firstSlice(symbolNames, targetPath, sliceFn);
  if (symbolHit !== null) {
    return { slice: symbolHit.slice, exports, kind: 'symbol', anchorName: symbolHit.name };
  }
  const sibling = siblingAnchorName(bundle);
  if (sibling !== null) {
    const sliced = sliceFn(targetPath, sibling);
    if (sliced !== null) return { slice: sliced, exports, kind: 'neighbor', anchorName: sibling };
  }
  return null;
};

const buildSliceSection = (
  targetPath: string,
  input: SliceInput
): string => {
  const exportLine =
    input.exports.length > 0
      ? `Existing exports (already present — extend, do not duplicate or remove): ${input.exports.join(', ')}.`
      : 'No top-level exports detected yet.';
  const neighborNote =
    input.kind === 'neighbor'
      ? ` The region above is the nearest EXISTING member \`${input.anchorName}\`, shown for placement: keep it intact (with its trailing comma) and append your NEW member immediately after it — do not remove or rename it.`
      : '';
  return (
    `Authorized edit region of ${targetPath} (lines ${input.slice.startLine}-${input.slice.endLine} — ` +
    `submit the FULL replacement region text via the submit_region tool):\n${input.slice.text}\n\n${exportLine}${neighborNote}`
  );
};

const tryBuildSlice = async (
  spec: TaskSpec,
  targetPath: string,
  read: FileReader,
  options: PreloadOptions
): Promise<string | null> => {
  const { regionStore, slice = sliceSymbol } = options;
  if (regionStore === undefined) return null;
  const input = await resolveSlice(spec, targetPath, read, slice);
  if (input === null) return null;
  regionStore.record(resolve(process.cwd(), targetPath), {
    startLine: input.slice.startLine,
    endLine: input.slice.endLine,
  });
  return buildSliceSection(targetPath, input);
};

const buildTargetOrSlice = async (
  spec: TaskSpec,
  read: FileReader,
  options: PreloadOptions
): Promise<string | null> => {
  if (spec.targetFiles.length === 0) return null;
  const targetPath = spec.targetFiles[0];
  options.regionStore?.clear(resolve(process.cwd(), targetPath));
  const sliceSection = await tryBuildSlice(spec, targetPath, read, options);
  return sliceSection ?? buildTargetSection(targetPath, read);
};

export const buildImplPreload = async (
  spec: TaskSpec,
  read: FileReader = defaultReader,
  options: PreloadOptions = {}
): Promise<string> => {
  const testPaths = (spec.existingTests ?? []).map(t => t.path);
  const [testSection, targetSection] = await Promise.all([
    buildTestSection(testPaths, read),
    buildTargetOrSlice(spec, read, options),
  ]);
  const sections = [testSection, targetSection].filter((s): s is string => s !== null);
  if (sections.length === 0) return '';
  return `\n\n${sections.join('\n\n')}`;
};
