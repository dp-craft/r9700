// Read-only symbol slicer for the "slice → edit → splice" edit flow. Resolves a
// symbol to its exact source span via ts-morph (reusing the lazy-Project pattern
// from tools/lib/tsMorphNav.ts). Priority: top-level declaration, then a named
// member (property/method) inside any object literal, then null.

import { Node, Project, type SourceFile } from 'ts-morph';

export interface SymbolSlice {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export function sliceSymbol(
  filePath: string,
  symbolName: string,
  project: Project = defaultProject(filePath)
): SymbolSlice | null {
  const sourceFile = project.getSourceFile(filePath);
  if (sourceFile === undefined) return null;
  const node = findTopLevel(sourceFile, symbolName) ?? findObjectMember(sourceFile, symbolName);
  return node === undefined ? null : sliceOf(node);
}

function defaultProject(filePath: string): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFileAtPathIfExists(filePath);
  return project;
}

function findTopLevel(sourceFile: SourceFile, name: string): Node | undefined {
  const candidates: readonly (Node | undefined)[] = [
    findVariableStatement(sourceFile, name),
    sourceFile.getFunction(name),
    sourceFile.getInterface(name),
    sourceFile.getTypeAlias(name),
  ];
  return candidates.find((node): node is Node => node !== undefined);
}

function findVariableStatement(sourceFile: SourceFile, name: string): Node | undefined {
  return sourceFile
    .getVariableStatements()
    .find(stmt => stmt.getDeclarations().some(decl => decl.getName() === name));
}

function findObjectMember(sourceFile: SourceFile, name: string): Node | undefined {
  return sourceFile.getDescendants().find(node => isNamedMember(node, name));
}

function isNamedMember(node: Node, name: string): boolean {
  const named = Node.isPropertyAssignment(node) || Node.isMethodDeclaration(node);
  return named && node.getName() === name;
}

function sliceOf(node: Node): SymbolSlice {
  const sourceFile = node.getSourceFile();
  const startLine = sourceFile.getLineAndColumnAtPos(node.getStart()).line;
  const endLine = sourceFile.getLineAndColumnAtPos(node.getEnd()).line;
  return { startLine, endLine, text: node.getText() };
}
