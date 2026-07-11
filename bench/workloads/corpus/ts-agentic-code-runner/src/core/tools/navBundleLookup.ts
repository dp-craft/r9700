import { readFile as fsReadFile } from 'node:fs/promises';

import type { LspQuery, NavBundleLookup } from './lsp';

type HoverMap = Record<string, unknown>;
type ExportsByFile = Record<string, unknown>;

interface ParsedBundle {
  readonly hover: HoverMap;
  readonly exportsByFile: ExportsByFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBundle(bundle: unknown): ParsedBundle {
  if (!isRecord(bundle)) return { hover: {}, exportsByFile: {} };
  return {
    hover: isRecord(bundle['hover']) ? (bundle['hover'] as HoverMap) : {},
    exportsByFile: isRecord(bundle['exportsByFile']) ? (bundle['exportsByFile'] as ExportsByFile) : {},
  };
}

function findHover(hover: HoverMap, symbol: string): string | null {
  const value = hover[symbol];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function findDefinition(exportsByFile: ExportsByFile, symbol: string): string | null {
  const entry = Object.entries(exportsByFile).find(
    ([, names]) => Array.isArray(names) && (names as unknown[]).includes(symbol)
  );
  return entry !== undefined ? entry[0] : null;
}

export function buildNavBundleLookup(bundle: unknown): NavBundleLookup {
  const { hover, exportsByFile } = parseBundle(bundle);
  return {
    find(q: LspQuery): string | null {
      if (q.op === 'hover') return findHover(hover, q.symbol);
      if (q.op === 'definition') return findDefinition(exportsByFile, q.symbol);
      return null;
    },
  };
}

// Read + JSON-parse a nav-bundle file; missing/malformed → null (the lookup
// then serves empty maps). Best-effort: the runner works without a bundle.
export const parseNavBundle = async (navBundlePath: string): Promise<unknown> => {
  try {
    const raw = await fsReadFile(navBundlePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
