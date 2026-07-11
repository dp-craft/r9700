import { readFile as fsReadFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildImplPreload,
  type FileReader,
  type PreloadOptions,
  type RegionStore,
  type TaskSpec
} from '../execution';
import type { RunMode } from '../shared';

const SINGLE_SHOT_BIAS =
  ' The failing test, collaborator signatures, spec excerpts, the full target source, and rules are all provided above and authoritative — resolve the task in a single pass with one well-anchored edit to the target file. You should NOT read the test file or re-read the target source to place the edit.';

const CODE_DRIVE_CONTRACT =
  ' The target file, failing test, and collaborator signatures provided below are current and authoritative — do NOT re-read them with read/grep/lsp; edit directly. Do NOT run tests, builds, or shell commands: after you finish editing, the harness automatically runs the full gate (test + lint + tsc + decomposition) and returns any failures for you to fix on the next attempt.';

// Closed-loop rubric (4.4b): a short numbered step list that ends in an explicit
// halt condition, so the model runs a bounded edit→gate→fix loop and stops calling
// tools once the change verifies instead of spinning on reads.
export const CLOSED_LOOP_RUBRIC =
  ' Work in a closed loop:' +
  ' (1) make the smallest edit that satisfies the failing check,' +
  ' (2) let the harness gate report back,' +
  ' (3) address only what the gate flags, then repeat.' +
  ' When the change is complete and verified, stop calling tools and state DONE.';

const KICKOFF_PROMPT =
  'Begin the task now. Use the provided tools to read, edit, and verify the target files.' +
  SINGLE_SHOT_BIAS +
  CODE_DRIVE_CONTRACT +
  CLOSED_LOOP_RUBRIC;
const TEST_KICKOFF_PROMPT =
  'Write a failing test for the target now. Do NOT implement the production code — only the test. Use the provided tools to read the existing test file and add your failing test to it.';
export const TDD_IMPL_KICKOFF_PROMPT =
  'A failing test for this task is shown below. Implement ONLY the production code in the target file(s) to make it pass — do NOT create or modify any test file. Use the edit tool with a unique anchor for a minimal change.' +
  SINGLE_SHOT_BIAS +
  CODE_DRIVE_CONTRACT +
  CLOSED_LOOP_RUBRIC;

// Slice-mode contract (3.4). Single-sourced here; the slice preload section
// appends it verbatim whenever the regionStore recorded an authorized region.
export const SLICE_KICKOFF_CONTRACT =
  'Slice-edit contract: the authorized edit region shown above is the ONLY part of this file you may change.' +
  ' Return the COMPLETE replacement for that region — every line from its first line to its last — by calling the submit_region tool with the file path and the full region content.' +
  ' Keep all code outside that region exactly as it is now, and include only code that belongs inside the region.' +
  ' Use submit_region for this file; use the edit and write tools only on other files, and do NOT read the whole file.';

const TAIL_ANCHOR_LINES = 6;

const defaultFileReader: FileReader = async (path: string): Promise<string | null> => {
  try {
    return await fsReadFile(path, 'utf8');
  } catch {
    return null;
  }
};

// Read the last TAIL_ANCHOR_LINES non-blank lines of a file. A multi-line tail is
// (effectively) unique even when its individual lines (e.g. `});`) repeat — giving
// the model an unambiguous append anchor that the verify_edit guard accepts.
const readTailAnchor = async (path: string, read: FileReader): Promise<string | null> => {
  const content = await read(path);
  if (content === null) return null;
  const lines = content.split('\n');
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  const start = Math.max(0, end - TAIL_ANCHOR_LINES);
  return lines.slice(start, end).join('\n');
};

export const buildTestKickoff = async (
  existingTests: readonly { readonly path: string }[] | undefined,
  read: FileReader = defaultFileReader
): Promise<string> => {
  if (existingTests === undefined || existingTests.length === 0) return TEST_KICKOFF_PROMPT;
  const paths = existingTests.map(t => t.path).join(', ');
  // The setup-head code-fence injection was removed: it primed the weak model to
  // reproduce/abbreviate file structure (eliding existing describe blocks → parse
  // error). Instead we inject the file's exact TAIL as a unique append anchor — a
  // single `});` is ambiguous (verify_edit rejects it), the multi-line tail is not.
  const base =
    TEST_KICKOFF_PROMPT +
    ` ADD your test to the EXISTING test file — do NOT create a new *.test file.` +
    ` Append a new describe/it block at the END of: ${paths}.` +
    ` Do NOT replace, abbreviate, or omit any existing test — never write "existing tests omitted".` +
    `\n\nWhen testing a Zustand store hook, invoke it CALLED — renderHook(() => useX()) — never pass it uncalled.`;
  const tail = await readTailAnchor(existingTests[0].path, read);
  if (tail === null) return base;
  return (
    base +
    `\n\nTo append safely, call the edit tool with this EXACT anchor (the file's current last lines):\n\`\`\`\n${tail}\n\`\`\`\n` +
    `Set replacement to those SAME lines unchanged, immediately followed by your new describe block. ` +
    `A single \`});\` is an ambiguous anchor and will be rejected — always use this full multi-line tail.`
  );
};

export const selectCodeKickoff = (mode: RunMode): string =>
  mode === 'tdd' ? TDD_IMPL_KICKOFF_PROMPT : KICKOFF_PROMPT;

// True only when the slice branch of buildImplPreload recorded an authorized
// region for the first target — that is the exact signal the model was shown a
// slice (not the full source) and must submit via submit_region.
const regionWasRecorded = (spec: TaskSpec, store: RegionStore | undefined): boolean =>
  store !== undefined &&
  spec.targetFiles.length > 0 &&
  store.get(resolve(process.cwd(), spec.targetFiles[0])) !== null;

// Builds the impl preload, then appends the slice contract exactly when the
// slice branch fired. Mirrors buildImplPreload's signature so the runner can
// swap it in place. Contract text stays single-sourced in SLICE_KICKOFF_CONTRACT.
export const buildImplPreloadWithSliceContract = async (
  spec: TaskSpec,
  read: FileReader | undefined,
  options: PreloadOptions
): Promise<string> => {
  const preload = await buildImplPreload(spec, read, options);
  return regionWasRecorded(spec, options.regionStore)
    ? `${preload}\n\n${SLICE_KICKOFF_CONTRACT}`
    : preload;
};

export const buildKickoff = (base: string, taskStatement: string | undefined): string =>
  taskStatement !== undefined && taskStatement.trim() !== ''
    ? `Task: ${taskStatement.trim()}\n\n${base}`
    : base;
