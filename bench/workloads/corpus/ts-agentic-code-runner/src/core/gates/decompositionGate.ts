import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { changedLineRanges } from './changedLines';
import type { GateContext, GateFailure, GateRunResult } from './gates';

// Cyclomatic-complexity cap via ESLint core `complexity` rule; default 5 matches
// the project commit gate (eslint.config.gate.mjs); RUNNER_MAX_COMPLEXITY overrides.
const DEFAULT_MAX_COMPLEXITY = 5;
const ESLINT_CONFIG_FILENAME = 'eslint-complexity.config.mjs';
const AGENTIC_RUNNER_DIR = '.agentic-runner';
const SOURCE_FILE_RE = /\.tsx?$/;
const TEST_FILE_RE = /\.(?:test|spec)\.tsx?$|[/\\]__tests__[/\\]/;

export const resolveMaxComplexity = (): number => {
  const parsed = Number(process.env.RUNNER_MAX_COMPLEXITY ?? DEFAULT_MAX_COMPLEXITY);
  return Number.isNaN(parsed) ? DEFAULT_MAX_COMPLEXITY : parsed;
};

// Only fresh source files are gated — test files are complexity-/FP-exempt by policy.
export const complexitySourceFiles = (files: readonly string[]): readonly string[] =>
  files.filter((file): boolean => SOURCE_FILE_RE.test(file) && !TEST_FILE_RE.test(file));

const complexityConfig = (max: number): string =>
  [
    `import tseslint from 'typescript-eslint';`,
    `export default [{ files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser }, rules: { complexity: ['error', ${max}] } }];`,
  ].join('\n');

// Config is written INSIDE the project tree (under .agentic-runner/) so that
// the ESM `import 'typescript-eslint'` resolves against the project's node_modules.
const writeComplexityConfig = async (cwd: string): Promise<string> => {
  const baseDir = join(cwd, AGENTIC_RUNNER_DIR);
  await mkdir(baseDir, { recursive: true });
  const dir = await mkdtemp(join(baseDir, 'eslint-'));
  const configPath = join(dir, ESLINT_CONFIG_FILENAME);
  await writeFile(configPath, complexityConfig(resolveMaxComplexity()), 'utf8');
  return configPath;
};

// Pure verdict: a non-zero exit is a real under-decomposition finding.
// Exit 0 = clean; any other failure (infra/missing binary) surfaces as non-null
// only when output is non-empty — a broken ESLint must never false-fail silently.
export const complexityFailure = (result: GateRunResult): GateFailure | null => {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return result.exitCode !== 0 && output.length > 0
    ? {
        gate: 'decomposition',
        message: 'functions exceed the cyclomatic-complexity cap — extract helpers to decompose',
        output,
      }
    : null;
};

// ESLint JSON result shapes (machine-readable output via --format json).
interface EslintMessage {
  readonly ruleId: string | null;
  readonly severity: number;
  readonly message: string;
  readonly line: number;
  readonly endLine?: number;
  readonly column: number;
}

interface EslintFileResult {
  readonly filePath: string;
  readonly messages: readonly EslintMessage[];
  readonly errorCount: number;
  readonly warningCount: number;
}

const parseEslintJson = (stdout: string): readonly EslintFileResult[] | null => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as EslintFileResult[]) : null;
  } catch {
    return null;
  }
};

// Returns true if the message's function range overlaps any changed line.
// Complexity violations report the declaration line (often outside the hunk)
// but endLine covers the full function body; we keep the finding if any changed
// line falls within [m.line .. m.endLine]. Falls back to exact-line match when
// endLine is absent (non-complexity rules report single-line violations).
const messageOverlapsChanged = (m: EslintMessage, changed: readonly number[]): boolean => {
  if (m.endLine === undefined) {
    return changed.includes(m.line);
  }
  return changed.some((l): boolean => l >= m.line && l <= (m.endLine as number));
};

const inRangeMessages = (
  results: readonly EslintFileResult[],
  changedByFile: ReadonlyMap<string, readonly number[]>
): readonly EslintMessage[] =>
  results.flatMap((r): readonly EslintMessage[] => {
    // Match by resolved path suffix (ESLint returns absolute paths)
    const entry = [...changedByFile.entries()].find(([f]) => r.filePath.endsWith(f));
    const changed = entry?.[1] ?? null;
    // null changed = file not in map (fallback whole-file) → keep all
    return changed === null
      ? r.messages
      : r.messages.filter((m): boolean => messageOverlapsChanged(m, changed));
  });

const renderDecompOutput = (results: readonly EslintFileResult[]): string =>
  results
    .flatMap((r): readonly string[] =>
      r.messages.map((m): string => `${r.filePath}:${m.line} — ${m.message}`)
    )
    .join('\n');

// Decomposition gate: every generated function must stay under the cyclomatic-
// complexity cap. A violation flows into the feedback loop as "extract helpers".
// Uses --format json + changed-range scoping so pre-existing violations in a
// 1992-line store never false-fail a single-action edit.
export const decompositionGate = async (
  files: readonly string[],
  ctx: GateContext
): Promise<GateFailure | null> => {
  const sources = complexitySourceFiles(files);
  if (sources.length === 0) {
    return null;
  }
  const configPath = await writeComplexityConfig(ctx.cwd);
  const args = sources.map((file): string => `'${resolve(ctx.cwd, file)}'`).join(' ');
  const result = await ctx.run(
    `npx eslint --no-config-lookup --config '${configPath}' --format json ${args}`
  );

  if (result.exitCode === 0) {
    return null;
  }

  const parsed = parseEslintJson(result.stdout);
  // Infra fallback: unparseable JSON → surface raw output (pre-existing behavior)
  if (parsed === null) {
    return complexityFailure(result);
  }

  // Build changed-line map for each source file
  const changedEntries = await Promise.all(
    sources.map(async (file): Promise<[string, readonly number[]]> => {
      // We need file text to count lines for new-file fallback. Re-read cheaply.
      const text = await readFile(resolve(ctx.cwd, file), 'utf8').catch((): string => '');
      return [file, await changedLineRanges(file, ctx, text)];
    })
  );
  const changedByFile = new Map<string, readonly number[]>(changedEntries);

  const inRange = inRangeMessages(parsed, changedByFile);
  if (inRange.length === 0) {
    return null;
  }

  // Re-render failure output with only in-range findings
  const filteredResults = parsed
    .map(
      (r): EslintFileResult => ({
        ...r,
        messages: inRange.filter((m): boolean =>
          parsed.find((fr): boolean => fr.filePath === r.filePath)?.messages.includes(m) ?? false
        ),
      })
    )
    .filter((r): boolean => r.messages.length > 0);

  return {
    gate: 'decomposition',
    message: 'functions exceed the cyclomatic-complexity cap — extract helpers to decompose',
    output: renderDecompOutput(filteredResults),
  };
};
