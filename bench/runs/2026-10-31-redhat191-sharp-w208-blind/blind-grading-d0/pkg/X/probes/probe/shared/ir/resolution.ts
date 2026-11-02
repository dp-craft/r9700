import { z } from 'zod';

import { addIssues, duplicatesOf, IsoDate, namesADirectory, NonEmpty } from './common.js';
import { SchemaVersionSchema } from './version.js';

/**
 * SPEC-A output: the goal set, and the noun -> surface resolution plus the drift table
 * that the current-state document is rendered from.
 */

const GOAL_ID_PATTERN = /^G-\d+$/u;
const NON_GOAL_ID_PATTERN = /^NG-\d+$/u;

export const GoalEntrySchema = z
  .strictObject({ id: z.string().regex(GOAL_ID_PATTERN), text: z.string().min(1), source: z.string().min(1) })
  .readonly();

export const NonGoalEntrySchema = z
  .strictObject({ id: z.string().regex(NON_GOAL_ID_PATTERN), text: z.string().min(1), source: z.string().min(1) })
  .readonly();

const goalSetFields = {
  goals: z.array(GoalEntrySchema).min(1).readonly(),
  nonGoals: z.array(NonGoalEntrySchema).readonly(),
};

interface GoalSetLike {
  readonly goals: readonly { readonly id: string }[];
  readonly nonGoals: readonly { readonly id: string }[];
}

/** Ids are the citation keys of every requirement, so they are unique across the WHOLE document. */
const duplicateIdMessages = (set: GoalSetLike): readonly string[] =>
  duplicatesOf([...set.goals, ...set.nonGoals].map(entry => entry.id)).map(id => `id "${id}" is used more than once`);

const refineUniqueIds = (set: GoalSetLike, ctx: z.core.$RefinementCtx<unknown>): void =>
  addIssues(ctx, ['goals'], duplicateIdMessages(set));

export const GoalSetSchema = z.strictObject(goalSetFields).superRefine(refineUniqueIds);

export const GoalsDocSchema = z.strictObject({ schemaVersion: SchemaVersionSchema, ...goalSetFields }).superRefine(refineUniqueIds);

export const SHAPE_KINDS = ['feature', 'modification', 'bug', 'refactor'] as const;
export const SURFACE_KINDS = ['feature', 'module', 'entry-point', 'unknown'] as const;

/**
 * Exactly the status vocabulary the current-state lint gate accepts. Widening it here would
 * produce a document that only fails later, at the gate, with no stage-local feedback.
 */
export const DRIFT_STATUSES = ['matches', 'drift', 'bug', 'unclear', 'new', 'broken'] as const;

/** The statuses whose claim is unverifiable without prose - the gate's MISSING_NOTES rule. */
const NOTES_REQUIRED_STATUSES: readonly string[] = ['matches', 'bug', 'broken', 'unclear'];

/**
 * The kinds that name ONE surface a reader can open. `feature` is absent because a feature
 * legitimately IS a directory, and `unknown` because it is the honest "resolved to nothing".
 */
const FILE_GRAINED_KINDS: readonly string[] = ['module', 'entry-point'];

interface MappingLike {
  readonly noun: string;
  readonly surfaceId: string | null;
  readonly kind: string;
  readonly path: string | null;
}

const directoryFieldsOf = (entry: MappingLike): readonly (readonly [string, string])[] => {
  const fields: readonly (readonly [string, string | null])[] = [
    ['surfaceId', entry.surfaceId],
    ['path', entry.path],
  ];
  return fields.filter((pair): pair is readonly [string, string] => pair[1] !== null && namesADirectory(pair[1]));
};

const grainMessage = (entry: MappingLike, field: string, value: string): string =>
  `noun "${entry.noun}": ${field} "${value}" names a directory, but kind "${entry.kind}" is file-grained - ` +
  `name the specific file this row touches (the row's own evidence usually cites one), or use ` +
  `kind: "feature" when the surface really is a directory, or null when it is unknown`;

/**
 * The same rule `spec-fill` applies to a touched-snapshot row, applied where the value is
 * PRODUCED: `surfaceId` becomes the outline stage's ref vocabulary, so a directory admitted
 * here is a legal enum member two stages on and only fails at the fill stage, with no
 * stage-local feedback - the reasoning DRIFT_STATUSES above already states. Both stages share
 * `namesADirectory` so "what is a directory" agrees by construction, not by two copies.
 */
export const refineMappingGrain = (entry: MappingLike, ctx: z.core.$RefinementCtx<unknown>): void => {
  if (!FILE_GRAINED_KINDS.includes(entry.kind)) return;
  directoryFieldsOf(entry).forEach(([field, value]) => addIssues(ctx, [field], [grainMessage(entry, field, value)]));
};

export const MappingEntrySchema = z
  .strictObject({
    noun: z.string().min(1),
    surfaceId: z.string().min(1).nullable(),
    kind: z.enum(SURFACE_KINDS),
    path: z.string().min(1).nullable(),
    evidence: z.string().min(1),
  })
  .superRefine(refineMappingGrain);

export const DriftEntrySchema = z.strictObject({
  id: z.string().min(1),
  snapshotSays: z.string().min(1),
  codeSays: z.string().min(1),
  status: z.enum(DRIFT_STATUSES),
  notes: z.string().nullable(),
});

interface ResolutionLike {
  readonly mapping: readonly { readonly noun: string; readonly surfaceId: string | null; readonly kind: string }[];
  readonly drift: readonly { readonly id: string; readonly status: string; readonly notes: string | null }[];
}

const notesMessages = (doc: ResolutionLike): readonly string[] =>
  doc.drift
    .filter(row => NOTES_REQUIRED_STATUSES.includes(row.status) && (row.notes ?? '').trim() === '')
    .map(row => `row "${row.id}": status "${row.status}" requires non-empty notes`);

const unresolvedKindMessages = (doc: ResolutionLike): readonly string[] =>
  doc.mapping
    .filter(entry => entry.surfaceId === null && entry.kind !== 'unknown')
    .map(entry => `noun "${entry.noun}": resolved to no surface, so kind MUST be "unknown"`);

/**
 * Both rules are the rendering gate's rules, enforced at authoring time: the rendered
 * current-state document then passes its lint by construction instead of failing a gate
 * one stage later, where the model has already lost the context that produced the row.
 */
const refineResolution = (doc: ResolutionLike, ctx: z.core.$RefinementCtx<unknown>): void => {
  addIssues(ctx, ['drift'], notesMessages(doc));
  addIssues(ctx, ['mapping'], unresolvedKindMessages(doc));
};

export const ResolutionDocSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    shape: z.enum(SHAPE_KINDS),
    mapping: z.array(MappingEntrySchema).min(1).readonly(),
    drift: z.array(DriftEntrySchema).readonly(),
    blastRadius: z.array(z.string().min(1)).readonly(),
  })
  .superRefine(refineResolution);

/**
 * The persisted resolution document: the model's output plus the emit clock and branch its
 * current-state.md rendered from, so re-rendering the same file never needs a second `now()` or
 * a look-up of the scope.
 */
export const ResolutionIrSchema = ResolutionDocSchema.safeExtend({ generatedAt: IsoDate, branch: NonEmpty });

/**
 * The legacy `resolution.json` the `/dpf.specify` command writes: one entry per resolved
 * request phrase, BEFORE the pipeline's structured resolution document exists. Non-strict on
 * purpose - the command persists extra fields into the same file (the freshness gate's
 * `freshnessDecision`), and a legacy reader must not refuse the document over them.
 */
const LegacyResolutionEntrySchema = z.object({
  request_phrase: z.string(),
  pick: z.string(),
  candidates: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export const LegacyResolutionSchema = z.object({
  resolved: z.array(LegacyResolutionEntrySchema),
});

export type GoalEntry = Readonly<z.infer<typeof GoalEntrySchema>>;
export type NonGoalEntry = Readonly<z.infer<typeof NonGoalEntrySchema>>;
export type GoalSet = Readonly<z.infer<typeof GoalSetSchema>>;
export type GoalsDoc = Readonly<z.infer<typeof GoalsDocSchema>>;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];
export type ResolutionDoc = Readonly<z.infer<typeof ResolutionDocSchema>>;
export type ResolutionIr = Readonly<z.infer<typeof ResolutionIrSchema>>;
export type LegacyResolution = Readonly<z.infer<typeof LegacyResolutionSchema>>;
