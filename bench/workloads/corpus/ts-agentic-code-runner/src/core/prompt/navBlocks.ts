import { type Collaborators } from '../execution';

const MAX_EXISTING_TEST_LINES = 80;

const EXISTING_TESTS_HEADER =
  'Existing tests — EXTEND these files; do not fork a new *.test file and do not ' +
  're-assert behavior already covered below:';

// Project the nav bundle's existing-test BDD context (path + describe/it tree) so
// the model extends the existing test file instead of forking a parallel *.new
// test. Deterministic; capped at 80 total tree lines across all files.
// Flatten each file's tree into `path:` followed by its tree lines, tagging every
// tree line with its file so the cap counts only tree lines (not path headers).
const flattenTreeLines = (
  files: readonly { readonly path: string; readonly describeItTree: readonly string[] }[]
): readonly { readonly path: string; readonly line: string }[] =>
  files.flatMap(t => t.describeItTree.map(line => ({ path: t.path, line })));

// Re-group capped tree lines back under their `path:` header, preserving order.
const groupByPath = (
  entries: readonly { readonly path: string; readonly line: string }[]
): string =>
  entries
    .reduce<readonly { readonly path: string; readonly lines: readonly string[] }[]>((acc, entry) => {
      const last = acc[acc.length - 1];
      if (last !== undefined && last.path === entry.path) {
        return [...acc.slice(0, -1), { path: last.path, lines: [...last.lines, entry.line] }];
      }
      return [...acc, { path: entry.path, lines: [entry.line] }];
    }, [])
    .map(g => `${g.path}:\n${g.lines.join('\n')}`)
    .join('\n');

const MAX_SIBLING_BODY_LINES = 40;

const COLLABORATORS_SIGNATURES_HEADER =
  'Collaborators — call these with their real signatures; do not invent or re-implement:';

const COLLABORATORS_SIBLING_HEADER =
  'Nearest existing sibling action (mirror its shape; do not copy verbatim):';

const COLLABORATORS_TYPE_SHAPES_HEADER =
  'Type shapes — construct/read these with the correct fields:';

const COLLABORATORS_IMPORTS_HEADER =
  'Required imports — ensure these exact lines exist in the target file\'s top import ' +
  'block (add any that are missing; do not duplicate existing ones):';

// A collaborator signature whose text begins with a `(from '<path>')` provenance
// prefix names a value import from that module; a same-file action (no prefix) does not.
const IMPORT_PATH_RE = /^\(from '([^']+)'\)/;

interface ImportEntry {
  readonly path: string;
  readonly name: string;
  readonly isType: boolean;
}

// Collect the type imports (each typeShape carrying an importPath) followed by the
// value imports (each signature whose text begins with a `(from '<path>')` prefix),
// in bundle order. Entries without a resolvable module path are dropped (e.g. same-file
// store actions like persistActiveRun, or type shapes with no importPath).
const collectImportEntries = (collaborators: Collaborators): readonly ImportEntry[] => {
  const typeEntries: readonly ImportEntry[] = (collaborators.typeShapes ?? [])
    .filter((t): t is { name: string; shape: string; importPath: string } =>
      t.importPath !== undefined && t.importPath !== '')
    .map(t => ({ path: t.importPath, name: t.name, isType: true }));
  const valueEntries: readonly ImportEntry[] = collaborators.signatures
    .map(s => ({ name: s.name, match: IMPORT_PATH_RE.exec(s.signature) }))
    .filter((s): s is { name: string; match: RegExpExecArray } => s.match !== null)
    .map(s => ({ path: s.match[1], name: s.name, isType: false }));
  return [...typeEntries, ...valueEntries];
};

// Render one grouped import line: a value import (value names first, type names tagged
// with the inline `type` keyword) when the group has any value member, else a
// `import type` line.
const renderImportLine = (path: string, entries: readonly ImportEntry[]): string => {
  const values = entries.filter(e => !e.isType).map(e => e.name);
  const types = entries.filter(e => e.isType).map(e => e.name);
  if (values.length === 0) {
    return `import type { ${types.join(', ')} } from '${path}';`;
  }
  const members = [...values, ...types.map(t => `type ${t}`)];
  return `import { ${members.join(', ')} } from '${path}';`;
};

// Paste-ready import lines derived from the nav bundle's collaborators. Types come
// from typeShapes[].importPath, value imports from signatures whose text carries a
// `(from '<path>')` prefix; a module with both is merged into one statement. Grouped
// by importPath in first-seen (bundle) order. Returns null when no entry resolves a
// path (the block is omitted).
const buildRequiredImportsSection = (collaborators: Collaborators): string | null => {
  const entries = collectImportEntries(collaborators);
  if (entries.length === 0) return null;
  const orderedPaths = entries.reduce<readonly string[]>(
    (acc, e) => (acc.includes(e.path) ? acc : [...acc, e.path]),
    []
  );
  const lines = orderedPaths.map(path =>
    renderImportLine(path, entries.filter(e => e.path === path))
  );
  return `${COLLABORATORS_IMPORTS_HEADER}\n${lines.join('\n')}`;
};

const buildSignaturesSection = (
  signatures: Collaborators['signatures']
): string =>
  `${COLLABORATORS_SIGNATURES_HEADER}\n${signatures.map(s => `${s.name}: ${s.signature}`).join('\n')}`;

const buildTypeShapesSection = (
  typeShapes: NonNullable<Collaborators['typeShapes']>
): string =>
  `${COLLABORATORS_TYPE_SHAPES_HEADER}\n${typeShapes
    .map(t => `${t.name}${t.importPath ? ` (from '${t.importPath}')` : ''} = ${t.shape}`)
    .join('\n')}`;

const buildSiblingSection = (
  siblingBody: NonNullable<Collaborators['siblingBody']>
): string => {
  const lines = siblingBody.body.split('\n');
  const kept = lines.slice(0, MAX_SIBLING_BODY_LINES);
  const body =
    lines.length > MAX_SIBLING_BODY_LINES
      ? `${kept.join('\n')}\n…(truncated)`
      : kept.join('\n');
  return `${COLLABORATORS_SIBLING_HEADER}\n${body}`;
};

export const buildCollaboratorsBlock = (collaborators: Collaborators | undefined): string => {
  if (collaborators === undefined) return '';
  const sections: string[] = [];
  const importsSection = buildRequiredImportsSection(collaborators);
  if (importsSection !== null) {
    sections.push(importsSection);
  }
  if (collaborators.signatures.length > 0) {
    sections.push(buildSignaturesSection(collaborators.signatures));
  }
  if (collaborators.typeShapes !== undefined && collaborators.typeShapes.length > 0) {
    sections.push(buildTypeShapesSection(collaborators.typeShapes));
  }
  if (collaborators.siblingBody !== null) {
    sections.push(buildSiblingSection(collaborators.siblingBody));
  }
  if (sections.length === 0) return '';
  return `\n\n${sections.join('\n\n')}`;
};

export const buildExistingTestsBlock = (
  existingTests: readonly { readonly path: string; readonly describeItTree: readonly string[] }[]
): string => {
  const files = existingTests.filter(t => t.describeItTree.length > 0);
  if (files.length === 0) return '';
  const allLines = flattenTreeLines(files);
  const kept = allLines.slice(0, MAX_EXISTING_TEST_LINES);
  const dropped = allLines.length - kept.length;
  const grouped = groupByPath(kept);
  const body = dropped > 0 ? `${grouped}\n… (+${dropped} more)` : grouped;
  return `\n\n${EXISTING_TESTS_HEADER}\n${body}`;
};

const SPEC_EXCERPTS_HEADER = 'Spec excerpts — the requirement text for this task:';

export const buildSpecExcerptsBlock = (excerpts: readonly string[] | undefined): string => {
  if (excerpts === undefined || excerpts.length === 0) return '';
  return `\n\n${SPEC_EXCERPTS_HEADER}\n${excerpts.join('\n')}`;
};

const REQUIREMENT_DETAILS_HEADER =
  'Requirement detail (what to build — implement to satisfy this):';

export const buildRequirementDetailsBlock = (
  details: readonly string[] | undefined
): string => {
  if (details === undefined || details.length === 0) return '';
  return `\n\n${REQUIREMENT_DETAILS_HEADER}\n${details.join('\n\n')}`;
};

const PLAN_ROWS_HEADER =
  'Placement & behavior guidance (where this goes / what it must do):';

export const buildPlanRowsBlock = (rows: readonly string[] | undefined): string => {
  if (rows === undefined || rows.length === 0) return '';
  return `\n\n${PLAN_ROWS_HEADER}\n${rows.join('\n')}`;
};
