import { readFile, writeFile } from 'node:fs/promises';

import type { Region, RegionStore } from '../execution';
import type { ToolResult } from '../shared';
import { type MutationTracker, snapshotOriginal } from './mutationTracker';
import { isAllowedTarget, resolveWithinCwd } from './pathPolicy';
import type { ToolHandler } from './toolRegistry';

const fail = (output: string): ToolResult => ({ ok: false, output });

const requireString = (args: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = args[key];
  return typeof value === 'string' ? value : null;
};

// Replace lines startLine..endLine (1-based, inclusive) with the content lines.
const spliceLines = (source: string, region: Region, content: string): string => {
  const lines = source.split('\n');
  const before = lines.slice(0, region.startLine - 1);
  const after = lines.slice(region.endLine);
  return [...before, ...content.split('\n'), ...after].join('\n');
};

const resolveTarget = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  path: string
): { readonly resolved: string } | ToolResult => {
  const resolved = resolveWithinCwd(cwd, path);
  if (resolved === null) return fail(`submit_region: path escapes working dir: ${path}`);
  if (!isAllowedTarget(cwd, allowedTargets, resolved)) {
    return fail(`submit_region: path not in declared targets: ${path}`);
  }
  return { resolved };
};

interface SpliceArgs {
  readonly resolved: string;
  readonly path: string;
  readonly content: string;
  readonly region: Region;
  readonly regionStore: RegionStore | undefined;
  readonly tracker: MutationTracker | undefined;
}

const applySplice = async (args: SpliceArgs): Promise<ToolResult> => {
  const { resolved, path, content, region, regionStore, tracker } = args;
  const original = tracker === undefined ? null : await snapshotOriginal(resolved);
  const current = await readFile(resolved, 'utf8').catch((): null => null);
  if (current === null) return fail(`submit_region: unable to read file: ${path}`);
  const written = await writeFile(resolved, spliceLines(current, region, content), 'utf8').then(
    (): boolean => true,
    (): boolean => false
  );
  if (!written) return fail(`submit_region: failed to write ${path}`);
  tracker?.record(resolved, original);
  const endLine = region.startLine + content.split('\n').length - 1;
  regionStore?.record(resolved, { startLine: region.startLine, endLine });
  return { ok: true, output: `submit_region: replaced lines ${region.startLine}-${region.endLine} of ${path}` };
};

export const submitRegionHandler = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  regionStore: RegionStore | undefined,
  tracker?: MutationTracker
): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const path = requireString(args, 'path');
    const content = requireString(args, 'content');
    if (path === null || content === null) {
      return fail('submit_region: missing string args "path" and "content"');
    }
    const target = resolveTarget(cwd, allowedTargets, path);
    if ('ok' in target) return target;
    const region = regionStore?.get(target.resolved) ?? null;
    if (region === null) {
      return fail(
        `submit_region: no authorized region recorded for ${path} — use the edit tool instead`
      );
    }
    return applySplice({ resolved: target.resolved, path, content, region, regionStore, tracker });
  };
};
