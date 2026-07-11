import { type Tool, tool, type ToolSet } from 'ai';
import { z } from 'zod';

import type { ToolResult } from '../shared';
import { createReciter, type RecitationContext } from './recitation';
import type { ToolHandler, ToolRegistry } from './toolRegistry';
import { resolveMaxToolOutputChars, truncateResult } from './truncate';

type Recite = (output: string) => string;
const identityRecite: Recite = (output: string): string => output;

// AI SDK input schemas — one per vendored handler, mirroring the arg names
// each handler destructures. The cwd-jail / footprint guard stays inside the
// handlers; buildSdkTools only wraps the already-jailed handler as execute.
const READ_SCHEMA = z.object({ path: z.string() });
const WRITE_SCHEMA = z.object({ path: z.string(), content: z.string() });
const EDIT_SCHEMA = z.object({
  path: z.string(),
  anchor: z.string(),
  replacement: z.string(),
});
const BASH_SCHEMA = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
});
const GREP_SCHEMA = z.object({ pattern: z.string() });
const SUBMIT_REGION_SCHEMA = z.object({ path: z.string(), content: z.string() });
const LSP_SCHEMA = z.object({
  op: z.enum(['definition', 'references', 'hover', 'implementation']),
  symbol: z.string(),
  file: z.string().optional(),
});

const wrap = <Schema extends z.ZodType>(
  description: string,
  inputSchema: Schema,
  handler: ToolHandler,
  recite: Recite = identityRecite
): Tool<z.infer<Schema>, ToolResult> =>
  tool({
    description,
    inputSchema,
    execute: async (args: z.infer<Schema>): Promise<ToolResult> => {
      const result = await handler(args as Readonly<Record<string, unknown>>);
      const truncated = truncateResult(result, resolveMaxToolOutputChars());
      return { ...truncated, output: recite(truncated.output) };
    },
  });

// The drive stage whose tool surface is being projected. `test` is the red-stage
// (ts-test-writer) seat; `code` is the impl-stage seat. Non-drive callers pass no
// kind and receive the full registry.
export type DriveStageKind = 'test' | 'code';

// Per-stage tool allowlists (G5): undirected tool breadth loops small models, so
// each drive stage sees only the tools its seat needs. `bash` + `grep` are dropped
// from both — the kickoff already forbids their main uses. Exported for drift tests.
export const TEST_DRIVE_TOOLS: readonly string[] = ['read', 'edit', 'verify_edit'];
export const CODE_DRIVE_TOOLS: readonly string[] = [
  'edit',
  'write',
  'verify_edit',
  'submit_region',
  'read',
  'lsp',
];

const STAGE_ALLOWLIST: Readonly<Record<DriveStageKind, readonly string[]>> = {
  test: TEST_DRIVE_TOOLS,
  code: CODE_DRIVE_TOOLS,
};

const pickTools = (tools: ToolSet, allow: readonly string[]): ToolSet =>
  Object.fromEntries(
    Object.entries(tools).filter(([name]: readonly [string, Tool]): boolean => allow.includes(name))
  );

export function buildSdkTools(
  registry: ToolRegistry,
  stageKind?: DriveStageKind,
  recitation?: RecitationContext
): ToolSet {
  const recite = recitation !== undefined ? createReciter(recitation) : identityRecite;
  const full = buildFullSdkTools(registry, recite);
  if (stageKind === undefined) return full;
  return pickTools(full, STAGE_ALLOWLIST[stageKind]);
}

function buildFullSdkTools(registry: ToolRegistry, recite: Recite): ToolSet {
  return {
    read: wrap('Read a UTF-8 file within the working dir.', READ_SCHEMA, registry.read, recite),
    write: wrap(
      'Write (create or overwrite) a file within the working dir. Overwriting an existing file larger than the configured line limit is rejected — use the edit tool for surgical changes to large files.',
      WRITE_SCHEMA,
      registry.write,
      recite
    ),
    edit: wrap(
      'Replace an anchor string in a file, verifying the edit applied. Falls back to whitespace-normalized matching when exact anchor is not found.',
      EDIT_SCHEMA,
      registry.edit,
      recite
    ),
    bash: wrap(
      'Run a command via execFile (no shell) in the working dir.',
      BASH_SCHEMA,
      registry.bash,
      recite
    ),
    grep: wrap(
      'Search files in the working dir for a literal substring.',
      GREP_SCHEMA,
      registry.grep,
      recite
    ),
    verify_edit: wrap(
      'Apply and verify an anchored edit to a file.',
      EDIT_SCHEMA,
      registry.verify_edit,
      recite
    ),
    lsp: wrap(
      'Look up a symbol in the nav bundle (definition/references/hover/implementation).',
      LSP_SCHEMA,
      registry.lsp,
      recite
    ),
    submit_region: wrap(
      'Replace the entire authorized slice region with `content`; supply the FULL replacement region text.',
      SUBMIT_REGION_SCHEMA,
      registry.submit_region,
      recite
    ),
  };
}
