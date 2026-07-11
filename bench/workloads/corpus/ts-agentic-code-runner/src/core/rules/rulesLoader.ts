import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface LoadOptions {
  readonly root?: string;
  readonly maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 8;
const IMPORT_LINE = /^@(\S+)$/;
const FRONTMATTER_FENCE = '---';

export const stripFrontmatter = (md: string): string => {
  const lines: readonly string[] = md.split('\n');
  if (lines[0] !== FRONTMATTER_FENCE) {
    return md;
  }
  const closeIndex = lines
    .slice(1)
    .findIndex((line: string): boolean => line === FRONTMATTER_FENCE);
  if (closeIndex === -1) {
    return md;
  }
  return lines.slice(closeIndex + 2).join('\n');
};

interface ExpandContext {
  readonly root: string;
  readonly maxDepth: number;
  readonly stack: readonly string[];
}

const readFileText = async (absPath: string, parent: string): Promise<string> => {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    throw new Error(`Failed to read @-import "${absPath}" referenced from "${parent}"`);
  }
};

const matchImport = (line: string): string | null => {
  const match = IMPORT_LINE.exec(line.trim());
  return match ? match[1] : null;
};

const guardRecursion = (absPath: string, ctx: ExpandContext): void => {
  if (ctx.stack.includes(absPath)) {
    throw new Error(`Import cycle detected at "${absPath}"`);
  }
  if (ctx.stack.length >= ctx.maxDepth) {
    throw new Error(`Max import depth ${ctx.maxDepth} exceeded at "${absPath}"`);
  }
};

const expandLine = async (line: string, parent: string, ctx: ExpandContext): Promise<string> => {
  const captured = matchImport(line);
  if (captured === null) {
    return line;
  }
  const absPath = resolve(ctx.root, captured);
  guardRecursion(absPath, ctx);
  return expandFile(absPath, parent, ctx);
};

const expandFile = async (absPath: string, parent: string, ctx: ExpandContext): Promise<string> => {
  const text = await readFileText(absPath, parent);
  const nextCtx: ExpandContext = { ...ctx, stack: [...ctx.stack, absPath] };
  const expanded = await Promise.all(
    text.split('\n').map((line: string): Promise<string> => expandLine(line, absPath, nextCtx))
  );
  return expanded.join('\n');
};

export const loadMarkdownWithImports = async (
  path: string,
  opts?: LoadOptions
): Promise<string> => {
  const absPath = resolve(path);
  const ctx: ExpandContext = {
    root: opts?.root ?? process.cwd(),
    maxDepth: opts?.maxDepth ?? DEFAULT_MAX_DEPTH,
    stack: [],
  };
  return expandFile(absPath, absPath, ctx);
};
