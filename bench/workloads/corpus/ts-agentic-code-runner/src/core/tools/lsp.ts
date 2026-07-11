// Nav-bundle-first LSP tool for the agentic code runner. Consults the provided
// nav bundle first; only on a miss does it lazily start ts-morph (a single
// `Project` is created on the first miss and reused across subsequent misses).

import { createTsMorphNav, type NavLocation, type TsMorphNav } from '../../../../lib/tsMorphNav';
import type { ToolResult } from '../shared';

export type LspOp = 'definition' | 'references' | 'hover' | 'implementation';

export interface LspQuery {
  readonly op: LspOp;
  readonly symbol: string;
  readonly file?: string;
}

export interface NavBundleLookup {
  readonly find: (q: LspQuery) => string | null;
}

export type NavFactory = (tsconfigPath: string) => TsMorphNav;

const APP_TSCONFIG = 'tsconfig.app.json';
const SCRIPTS_TSCONFIG = 'tsconfig.scripts.json';

// Pick the tsconfig whose `include` covers the queried file: `tools/` symbols
// resolve via the scripts project, everything else (src/, undefined) via the app
// project so the runner's LSP can see the `src/` app code it edits.
export function tsconfigForFile(file: string | undefined): string {
  return file?.startsWith('tools/') === true ? SCRIPTS_TSCONFIG : APP_TSCONFIG;
}

// Memoize one TsMorphNav per resolved tsconfig so repeated misses reuse a single
// lazily-created ts-morph Project (lazy-once invariant) while letting the app and
// scripts navs coexist.
const navCache = new Map<string, TsMorphNav>();

// Test-only: clears the module-level nav cache so each test observes the
// lazy-once behavior from a fresh state (production keeps the cache for reuse).
export function __resetNavCacheForTests(): void {
  navCache.clear();
}

function getNav(factory: NavFactory, tsconfigPath: string): TsMorphNav {
  const cached = navCache.get(tsconfigPath);
  if (cached !== undefined) return cached;
  const nav = factory(tsconfigPath);
  navCache.set(tsconfigPath, nav);
  return nav;
}

function formatLocation(location: NavLocation): string {
  return `${location.file}:${location.line}:${location.column}`;
}

function formatLocations(locations: readonly NavLocation[]): ToolResult {
  if (locations.length === 0) return { ok: false, output: 'No results.' };
  return { ok: true, output: locations.map(formatLocation).join('\n') };
}

function runLiveQuery(nav: TsMorphNav, query: LspQuery): ToolResult {
  switch (query.op) {
    case 'definition':
      return formatLocations(nav.definition(query.symbol, query.file));
    case 'references':
      return formatLocations(nav.references(query.symbol, query.file));
    case 'implementation':
      return formatLocations(nav.implementation(query.symbol, query.file));
    case 'hover': {
      const text = nav.hover(query.symbol, query.file);
      return text === null ? { ok: false, output: 'No results.' } : { ok: true, output: text };
    }
  }
}

export function lspTool(
  navBundle: NavBundleLookup,
  query: LspQuery,
  factory: NavFactory = createTsMorphNav
): Promise<ToolResult> {
  const bundled = navBundle.find(query);
  if (bundled !== null) return Promise.resolve({ ok: true, output: bundled });
  const nav = getNav(factory, tsconfigForFile(query.file));
  return Promise.resolve(runLiveQuery(nav, query));
}
