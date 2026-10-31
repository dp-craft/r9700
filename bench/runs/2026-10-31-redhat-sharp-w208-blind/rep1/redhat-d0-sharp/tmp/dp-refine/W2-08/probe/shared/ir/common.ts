import { z } from 'zod';

import { parsePath } from './path.js';

/** Pieces every IR document schema shares: shared field schemas, issue formatting, duplicate detection, the surface-name rule. */

/** A string that must carry content - the empty string is never a value in an IR document. */
export const NonEmpty = z.string().min(1);

/**
 * A root-relative path into the feature dir: never absolute, and no `..` segment that could
 * escape it. The reader resolves it against the dir the document lives in.
 */
export const RelPath = z
  .string()
  .min(1)
  .refine(value => !value.startsWith('/'), 'must be root-relative')
  .refine(value => !value.split('/').includes('..'), 'must not contain a .. segment');

/** A string the IR path grammar accepts: `parsePath` must round-trip it. */
export const JsonPathString = z.string().refine(value => parsePath(value).ok, 'is not a parseable IR path');

/** A plain object: not null, not an array - the shape a legacy document arrives as. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An ISO-8601 date-time with a time zone - the only timestamp form an IR document carries. */
export const IsoDate = z.iso.datetime();

/** The stamp a document written before W2-06's persist carried - migration fills it ONLY when missing. */
export const PRE_W206_GENERATED_AT = '1970-01-01T00:00:00.000Z';

/** The branch a document written before W2-07's persist carried - migration fills it ONLY when missing. */
export const PRE_W207_BRANCH = 'unknown-branch';

/** A persisted document without its emit clock gets the fixed sentinel; a current one is left alone. */
export const stampWhenMissing = (field: string, sentinel: string): ((raw: unknown) => unknown) => raw =>
  isRecord(raw) && !(field in raw) ? { ...raw, [field]: sentinel } : raw;

/**
 * A record that either RAN (carrying `shape`) or was SKIPPED loudly: a skip without a reason is
 * indistinguishable from a run nobody did, so the reason is mandatory on the skip branch.
 */
export const LoudSkip = <T extends { readonly [key: string]: z.ZodType }>(shape: T) =>
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ran'), ...shape }),
    z.strictObject({ status: z.literal('skipped'), reason: NonEmpty }),
  ]);

export type RefinementCtx = z.core.$RefinementCtx<unknown>;

interface ZodIssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** A retry gets `where — what`, the smallest string a model can act on. */
export const formatIssue = (issue: ZodIssueLike): string =>
  `${issue.path.length === 0 ? '(root)' : issue.path.join('.')} — ${issue.message}`;

export const issueMessages = (error: { readonly issues: readonly ZodIssueLike[] }): readonly string[] =>
  error.issues.map(formatIssue);

export const addIssues = (ctx: RefinementCtx, path: readonly PropertyKey[], messages: readonly string[]): void => {
  messages.forEach(message => ctx.addIssue({ code: 'custom', message, path: [...path] }));
};

/** Values appearing more than once, each reported once. */
export const duplicatesOf = (values: readonly string[]): readonly string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

/**
 * `file` names a SURFACE the reader can open - a document or a source file - never the
 * directory that contains it. A completed run emitted `services/llm/`, which the spec renderer
 * printed verbatim into the Touched Snapshot column: a row pointing at a folder, with no
 * error anywhere. The rule is measured against the shipped corpus, where 0 of 196 rows name
 * a directory, so it rejects the observed defect without invalidating a single shipped row.
 */
export const namesADirectory = (file: string): boolean => file.trimEnd().endsWith('/');
