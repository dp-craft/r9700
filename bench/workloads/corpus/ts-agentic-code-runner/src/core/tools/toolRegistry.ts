import type { RegionStore } from '../execution';
import type { ToolResult } from '../shared';
import {
  bashHandler,
  editHandler,
  grepHandler,
  lspHandler,
  readHandler,
  verifyEditHandler,
  writeHandler
} from './handlers';
import type { NavBundleLookup } from './lsp';
import { createMutationTracker, type MutationTracker } from './mutationTracker';
import { submitRegionHandler } from './submitRegionHandler';

export type ToolHandler = (args: Readonly<Record<string, unknown>>) => Promise<ToolResult>;

export interface ToolRegistry {
  readonly read: ToolHandler;
  readonly write: ToolHandler;
  readonly edit: ToolHandler;
  readonly bash: ToolHandler;
  readonly grep: ToolHandler;
  readonly verify_edit: ToolHandler;
  readonly lsp: ToolHandler;
  readonly submit_region: ToolHandler;
}

export function createToolRegistry(
  cwd: string,
  navBundle: NavBundleLookup = { find: (): null => null },
  allowedTargets?: readonly string[],
  tracker?: MutationTracker,
  regionStore?: RegionStore
): ToolRegistry {
  return {
    read: readHandler(cwd),
    write: writeHandler(cwd, allowedTargets, tracker),
    edit: editHandler(cwd, allowedTargets, tracker),
    bash: bashHandler(cwd),
    grep: grepHandler(cwd),
    verify_edit: verifyEditHandler(cwd, allowedTargets, tracker),
    lsp: lspHandler(navBundle),
    submit_region: submitRegionHandler(cwd, allowedTargets, regionStore, tracker),
  };
}

// Re-export shims: the mutation tracker and SDK-tool builder moved to sibling
// files, but the tools/ barrel and the co-located tests still import them from
// this assembly module — preserve those import paths.
export { createMutationTracker };
export type { MutationTracker };
export type { DriveStageKind } from './schemas';
export { buildSdkTools, CODE_DRIVE_TOOLS, TEST_DRIVE_TOOLS } from './schemas';
