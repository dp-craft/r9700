import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import ts from 'typescript';

import { changedLineRanges } from './changedLines';
import { complexitySourceFiles } from './decompositionGate';
import type { GateContext, GateFailure } from './gates';

// ---------------------------------------------------------------------------
// Functional-style gate: flags imperative constructs in generated source.
// ---------------------------------------------------------------------------

const FP_GATE_ENV = 'RUNNER_FP_GATE';

export interface FpViolation {
  readonly kind: string;
  readonly line: number;
}

const FP_VIOLATION_KINDS: Readonly<Record<number, string>> = {
  [ts.SyntaxKind.ForStatement]: 'for loop',
  [ts.SyntaxKind.ForInStatement]: 'for loop',
  [ts.SyntaxKind.ForOfStatement]: 'for loop',
  [ts.SyntaxKind.WhileStatement]: 'while loop',
  [ts.SyntaxKind.DoStatement]: 'do-while loop',
  [ts.SyntaxKind.ClassDeclaration]: 'class',
};

const nodeViolationKind = (node: ts.Node, src: ts.SourceFile): FpViolation | null => {
  const kindName = FP_VIOLATION_KINDS[node.kind];
  if (kindName !== undefined) {
    return { kind: kindName, line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 };
  }
  if (ts.isVariableStatement(node)) {
    const flags = node.declarationList.flags;
    if (flags & ts.NodeFlags.Let) {
      return { kind: 'let', line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 };
    }
    if (!(flags & ts.NodeFlags.Const)) {
      return { kind: 'var', line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1 };
    }
  }
  return null;
};

const walkNode = (node: ts.Node, src: ts.SourceFile, acc: FpViolation[]): void => {
  const violation = nodeViolationKind(node, src);
  if (violation !== null) {
    acc.push(violation);
  }
  ts.forEachChild(node, child => walkNode(child, src, acc));
};

export const fpViolations = (sourceText: string, filePath: string): readonly FpViolation[] => {
  const src = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const acc: FpViolation[] = [];
  walkNode(src, src, acc);
  return acc;
};

interface FileViolations {
  readonly text: string;
  readonly violations: readonly FpViolation[];
}

const readViolations = async (file: string, cwd: string): Promise<FileViolations> => {
  try {
    const text = await readFile(resolve(cwd, file), 'utf8');
    return { text, violations: fpViolations(text, file) };
  } catch {
    return { text: '', violations: [] };
  }
};

const fpOutputLine = (file: string, v: FpViolation): string => `${file}:${v.line} — ${v.kind}`;

export const functionalStyleGate = async (
  files: readonly string[],
  ctx: GateContext
): Promise<GateFailure | null> => {
  if (process.env[FP_GATE_ENV] === '0') {
    return null;
  }
  const sources = complexitySourceFiles(files);
  if (sources.length === 0) {
    return null;
  }
  const violationSets = await Promise.all(
    sources.map(async (file): Promise<readonly string[]> => {
      const { text, violations } = await readViolations(file, ctx.cwd);
      const changed = await changedLineRanges(file, ctx, text);
      // changed empty = file unchanged vs HEAD → no violations to report
      const inRange =
        changed.length === 0 ? [] : violations.filter((v): boolean => changed.includes(v.line));
      return inRange.map((v): string => fpOutputLine(file, v));
    })
  );
  const lines = violationSets.flat();
  if (lines.length === 0) {
    return null;
  }
  return {
    gate: 'functional-style',
    message:
      'imperative constructs found — replace loops with .map()/.filter()/.find(), use const, use functions not classes',
    output: lines.join('\n'),
  };
};
