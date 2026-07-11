import { readFile, writeFile } from 'node:fs/promises';

import { resolveLargeFileLines } from '../execution';
import type { ToolResult } from '../shared';
import { type LspOp, type LspQuery, lspTool, type NavBundleLookup } from './lsp';
import { execFileAsync, type MutationTracker, snapshotOriginal } from './mutationTracker';
import { existingLineCount, isAllowedTarget, resolveWithinCwd } from './pathPolicy';
import type { ToolHandler } from './toolRegistry';
import { verifyEdit } from './verifyEdit';

const LSP_OPS: readonly LspOp[] = ['definition', 'references', 'hover', 'implementation'];

const fail = (output: string): ToolResult => ({ ok: false, output });

const requireString = (args: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = args[key];
  return typeof value === 'string' ? value : null;
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item): boolean => typeof item === 'string');

const isLspOp = (value: unknown): value is LspOp =>
  typeof value === 'string' && LSP_OPS.includes(value as LspOp);

export const readHandler = (cwd: string): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const path = requireString(args, 'path');
    if (path === null) {
      return fail('read: missing string arg "path"');
    }
    const resolved = resolveWithinCwd(cwd, path);
    if (resolved === null) {
      return fail(`read: path escapes working dir: ${path}`);
    }
    const content = await readFile(resolved, 'utf8').catch((): null => null);
    return content === null
      ? fail(`read: unable to read file: ${path}`)
      : { ok: true, output: content };
  };
};

export const writeHandler = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  tracker?: MutationTracker
): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const path = requireString(args, 'path');
    const content = requireString(args, 'content');
    if (path === null || content === null) {
      return fail('write: missing string args "path" and "content"');
    }
    const resolved = resolveWithinCwd(cwd, path);
    if (resolved === null) {
      return fail(`write: path escapes working dir: ${path}`);
    }
    if (!isAllowedTarget(cwd, allowedTargets, resolved)) {
      return fail(`write: path not in declared targets: ${path}`);
    }
    const existingLines = await existingLineCount(resolved);
    const limit = resolveLargeFileLines();
    if (existingLines !== null && existingLines > limit) {
      return fail(
        `write: refusing to overwrite a large file (${existingLines} lines > limit) — use the edit tool for surgical changes, not whole-file rewrites`
      );
    }
    const original = tracker === undefined ? null : await snapshotOriginal(resolved);
    const result = await writeFile(resolved, content, 'utf8').then(
      (): ToolResult => ({ ok: true, output: `write: wrote ${path}` }),
      (error: unknown): ToolResult => fail(`write: failed for ${path}: ${String(error)}`)
    );
    if (result.ok) {
      tracker?.record(resolved, original);
    }
    return result;
  };
};

export const editHandler = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  tracker?: MutationTracker
): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const path = requireString(args, 'path');
    const anchor = requireString(args, 'anchor');
    const replacement = requireString(args, 'replacement');
    if (path === null || anchor === null || replacement === null) {
      return fail('edit: missing string args "path", "anchor", "replacement"');
    }
    const resolved = resolveWithinCwd(cwd, path);
    if (resolved === null) {
      return fail(`edit: path escapes working dir: ${path}`);
    }
    if (!isAllowedTarget(cwd, allowedTargets, resolved)) {
      return fail(`edit: path not in declared targets: ${path}`);
    }
    const original = tracker === undefined ? null : await snapshotOriginal(resolved);
    const result = await verifyEdit({ path: resolved, anchor, replacement });
    if (result.ok) {
      tracker?.record(resolved, original);
    }
    return result;
  };
};

// Trust boundary: the model drives execution. We use execFile (no shell), so
// the command is the executable and `args` are literal argv tokens — shell
// metacharacters (;, |, &&, $()) are NEVER interpreted.
export const bashHandler = (cwd: string): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const command = requireString(args, 'command');
    if (command === null) {
      return fail('bash: missing string arg "command"');
    }
    const rawArgs = args.args;
    if (rawArgs !== undefined && !isStringArray(rawArgs)) {
      return fail('bash: arg "args" must be a string[]');
    }
    const argv: readonly string[] = rawArgs === undefined ? [] : rawArgs;
    return execFileAsync(command, [...argv], { cwd }).then(
      ({ stdout, stderr }): ToolResult => ({ ok: true, output: `${stdout}${stderr}` }),
      (error: unknown): ToolResult => {
        // A non-zero exit (e.g. ESLint finding lint problems) rejects with the
        // child's stdout/stderr attached. Surface them — ESLint writes its
        // findings to STDOUT, so dropping it leaves the model blind to WHY a
        // gate failed and unable to iterate. (Mirrors gitGrepError + gateRun.)
        const e = error as {
          readonly code?: number | string;
          readonly stdout?: string;
          readonly stderr?: string;
        };
        const body = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
        return fail(
          `bash: command exited non-zero (${e.code ?? '?'}): ${command}\n` +
            (body.length > 0 ? body : String(error))
        );
      }
    );
  };
};

export const verifyEditHandler = (
  cwd: string,
  allowedTargets: readonly string[] | undefined,
  tracker?: MutationTracker
): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const path = requireString(args, 'path');
    const anchor = requireString(args, 'anchor');
    const replacement = requireString(args, 'replacement');
    if (path === null || anchor === null || replacement === null) {
      return fail('verify_edit: missing string args "path", "anchor", "replacement"');
    }
    const resolved = resolveWithinCwd(cwd, path);
    if (resolved === null) {
      return fail(`verify_edit: path escapes working dir: ${path}`);
    }
    if (!isAllowedTarget(cwd, allowedTargets, resolved)) {
      return fail(`verify_edit: path not in declared targets: ${path}`);
    }
    const original = tracker === undefined ? null : await snapshotOriginal(resolved);
    const result = await verifyEdit({ path: resolved, anchor, replacement });
    if (result.ok) {
      tracker?.record(resolved, original);
    }
    return result;
  };
};

export const lspHandler = (navBundle: NavBundleLookup): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const op = args.op;
    const symbol = requireString(args, 'symbol');
    if (!isLspOp(op)) {
      return fail(`lsp: invalid "op" (expected ${LSP_OPS.join(' | ')})`);
    }
    if (symbol === null) {
      return fail('lsp: missing string arg "symbol"');
    }
    const file = requireString(args, 'file');
    const query: LspQuery = file === null ? { op, symbol } : { op, symbol, file };
    return lspTool(navBundle, query);
  };
};

// Cap the buffered grep stdout (the model only ever sees the truncated tool
// result); this is a memory ceiling, not the 4 GB whole-tree slurp the old
// hand-rolled grep caused by reading every file — incl. release binaries — as utf8.
const GREP_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const FALLBACK_EXCLUDE_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'release',
  'coverage',
];

// `git grep`: native (C, streaming), honours .gitignore, skips binaries (-I),
// extended-regex (-E), and includes the agent's untracked new files.
const gitGrepArgs = (pattern: string): readonly string[] => [
  'grep',
  '-nIE',
  '--untracked',
  '-e',
  pattern,
];

// system `grep -r` fallback for a non-git working dir (also native + streaming).
const systemGrepArgs = (pattern: string): readonly string[] => [
  '-rnIE',
  ...FALLBACK_EXCLUDE_DIRS.map((dir): string => `--exclude-dir=${dir}`),
  '-e',
  pattern,
  '.',
];

const grepStdout = (result: { readonly stdout: string }): ToolResult => ({
  ok: true,
  output: result.stdout,
});

// Exit 1 = no matches (success, empty). A maxBuffer overflow still carries partial
// stdout — return it (the wrapper truncates anyway). Anything else (e.g. "not a git
// repository", missing binary) → null so the caller can fall back.
const grepError = (error: unknown): ToolResult | null => {
  const e = error as { readonly code?: number | string; readonly stdout?: string };
  if (e.code === 1) {
    return { ok: true, output: '' };
  }
  return typeof e.stdout === 'string' && e.stdout.length > 0
    ? { ok: true, output: e.stdout }
    : null;
};

const runGrep = (cmd: string, argv: readonly string[], cwd: string): Promise<ToolResult | null> =>
  execFileAsync(cmd, [...argv], { cwd, maxBuffer: GREP_MAX_BUFFER_BYTES }).then(
    grepStdout,
    grepError
  );

export const grepHandler = (cwd: string): ToolHandler => {
  return async (args): Promise<ToolResult> => {
    const pattern = requireString(args, 'pattern');
    if (pattern === null) {
      return fail('grep: missing string arg "pattern"');
    }
    const viaGit = await runGrep('git', gitGrepArgs(pattern), cwd);
    if (viaGit !== null) {
      return viaGit;
    }
    const viaSystem = await runGrep('grep', systemGrepArgs(pattern), cwd);
    return viaSystem ?? fail('grep: neither git grep nor system grep is available');
  };
};
