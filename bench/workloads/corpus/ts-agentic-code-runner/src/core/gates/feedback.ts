import type { ModelMessage } from 'ai';

import type { GateFailure, GateName } from './gates';

// Retry feedback + no-progress detection for the escalation loop. Pure functions
// only — the loop in runner.ts threads these between attempts.

// Lowered from 4000: localized extraction keeps the salient lines; 900 chars
// fits ~12 concise error lines without burying the model in banner noise.
export const FEEDBACK_MAX_OUTPUT_CHARS = 900;

// Volatile bits that differ run-to-run for the SAME failure (durations, counts in
// parens, clock times) — stripped so the signature is stable across attempts.
// ANSI codes are not stripped: they are stable for a given failure, so they do
// not affect signature stability.
const VOLATILE_RE = /\b\d+(?:\.\d+)?\s?m?s\b|\(\d+\)|\d{2}:\d{2}:\d{2}/g;
const FAIL_LINE_RE = /FAIL|✗|×|✘|AssertionError|[Ee]xpected|error TS\d+/;

// Gates whose entire output is already the concise finding list — no extraction needed.
const VERBATIM_GATES: ReadonlySet<GateName> = new Set(['decomposition', 'functional-style']);

// One-line fix hints appended to each feedback message. Gives small models a
// concrete next action without requiring them to interpret the gate name alone.
const FIX_HINTS: Readonly<Record<GateName, string>> = {
  decomposition: 'Extract small helpers so each function\'s complexity ≤ the cap.',
  'functional-style': 'Replace loops with .map()/.filter(); use const, not let/var; no classes.',
  test: 'Make the implementation satisfy the failing assertion.',
  tsc: 'Fix the reported type error.',
  lint: 'Fix the reported lint rule violation.',
  drive: 'Address the issue identified above and re-run the tool.',
};

// Which authoritative-source contract covered the target file this attempt, so
// retry feedback stays consistent with the kickoff instead of countermanding it
// (G2). `slice` = the model was shown an authorized region and submits via
// submit_region; `preload` = full source was preloaded and edits are current;
// `none` = nothing preloaded, so reading the current file state is legitimate.
export type FeedbackFileContext = 'slice' | 'preload' | 'none';

// The "how to fix" directive that leads the failure output — chosen per file
// context so it never contradicts the kickoff contract the model already has.
const FIX_DIRECTIVE: Readonly<Record<FeedbackFileContext, string>> = {
  slice:
    'Fix the cause, then resubmit the complete edit region with submit_region — do NOT re-read the whole file:',
  preload:
    'The preloaded source above plus your applied edits are current — fix the cause with the edit tool; no re-read is needed:',
  none: 'Read the current state of the target files, then fix the cause:',
};

const FALLBACK_LINE_COUNT = 12;

const normalizeLine = (line: string): string => line.replace(VOLATILE_RE, '').trim();

// Stable identity of a failure: gate + the normalized, sorted set of failing
// lines (or the whole normalized output when no failing lines are recognised).
// Two attempts that fail the same way yield the same signature.
export const failureSignature = (failure: GateFailure): string => {
  const failing = failure.output
    .split('\n')
    .map(normalizeLine)
    .filter((line): boolean => line.length > 0 && FAIL_LINE_RE.test(line));
  const body = failing.length > 0 ? [...failing].sort().join('\n') : normalizeLine(failure.output);
  return `${failure.gate}|${body}`;
};

// No progress = this failure was already seen in an earlier attempt. Feedback did
// not change the outcome, so the implementation is stuck or the test is wrong —
// stop early instead of burning the rest of the ladder.
export const isNoProgress = (history: readonly string[], current: string): boolean =>
  history.includes(current);

const clipToMax = (text: string): string =>
  text.length > FEEDBACK_MAX_OUTPUT_CHARS
    ? `${text.slice(0, FEEDBACK_MAX_OUTPUT_CHARS)}\n…[truncated]…`
    : text;

const extractFailingLines = (output: string): readonly string[] =>
  output.split('\n').filter((line): boolean => FAIL_LINE_RE.test(line));

const firstNLines = (output: string, n: number): string =>
  output.split('\n').slice(0, n).join('\n');

// Selects only the salient lines from a gate failure output. Verbatim gates
// (decomposition, functional-style) already emit concise finding lists — kept
// as-is. For all others, extract lines matching FAIL_LINE_RE; fall back to the
// first FALLBACK_LINE_COUNT lines when none match.
export const localizeOutput = (failure: GateFailure): string => {
  if (VERBATIM_GATES.has(failure.gate)) {
    return clipToMax(failure.output);
  }
  const failing = extractFailingLines(failure.output);
  const body =
    failing.length > 0 ? failing.join('\n') : firstNLines(failure.output, FALLBACK_LINE_COUNT);
  return clipToMax(body);
};

// Matches parse/transform failures that prevent tests from running at all.
// Must NOT match normal vitest assertion failures.
const TRANSFORM_ERROR_RE =
  /Transform failed|ERROR: Unexpected|ERROR: Expected|ERROR: Unterminated|SyntaxError|Failed to parse/;

export const isTransformError = (output: string): boolean =>
  TRANSFORM_ERROR_RE.test(output);

// Feedback prepended to the next attempt. For the test gate, forbid editing tests
// (a weak model otherwise "fixes" failures by mutating the assertions).
// Exception: when the test file has a syntax/parse error it did not even run —
// the model MUST fix the test-file syntax, so editing is explicitly permitted.
export const buildFeedbackMessage = (
  failure: GateFailure,
  context: FeedbackFileContext = 'none'
): string => {
  const directive = FIX_DIRECTIVE[context];
  if (failure.gate === 'test' && isTransformError(failure.output)) {
    return (
      `Your previous attempt did not pass the ${failure.gate} gate.\n` +
      `The test file has a syntax error and did not parse — fix the test-file syntax. ` +
      `You MAY edit the test file to correct the syntax error.\n` +
      `${directive}\n${clipToMax(failure.output)}`
    );
  }
  const noEditTests =
    failure.gate === 'test'
      ? ' Fix the implementation so these pass; do NOT edit the test files.'
      : '';
  const hint = FIX_HINTS[failure.gate];
  return (
    `Your previous attempt did not pass the ${failure.gate} gate.${noEditTests}\n` +
    `${directive}\n${localizeOutput(failure)}\n${hint}`
  );
};

// ---------------------------------------------------------------------------
// Conclusion ledger — stage-tagged retry memory
// ---------------------------------------------------------------------------

// A single recorded failure outcome from one drive attempt.
export interface Conclusion {
  readonly attempt: number;
  readonly stage: 'test' | 'code';
  readonly signature: string;
  readonly note: string;
}

// Ordered history of conclusions, bounded by LEDGER_CAP.
export type Ledger = readonly Conclusion[];

// Maximum number of conclusions retained in the ledger (oldest dropped beyond cap).
export const LEDGER_CAP = 5;

// Append a conclusion and drop the oldest entry when the cap is exceeded.
export const appendConclusion = (ledger: Ledger, c: Conclusion): Ledger =>
  [...ledger, c].slice(-LEDGER_CAP);

// Build a Conclusion from a gate failure. When `summarize` is provided its
// result is used as the note; any falsy/empty result or thrown error falls back
// to the deterministic buildFeedbackMessage output.
export const extractConclusion = async (
  failure: GateFailure,
  attempt: number,
  stage: 'test' | 'code',
  summarize?: (f: GateFailure) => Promise<string | null>,
  context: FeedbackFileContext = 'none'
): Promise<Conclusion> => {
  const signature = failureSignature(failure);
  const fallbackNote = buildFeedbackMessage(failure, context);

  if (summarize === undefined) {
    return { attempt, stage, signature, note: fallbackNote };
  }

  try {
    const result = await summarize(failure);
    const note = result !== null && result.length > 0 ? result : fallbackNote;
    return { attempt, stage, signature, note };
  } catch {
    return { attempt, stage, signature, note: fallbackNote };
  }
};

const formatConclusionNote = (c: Conclusion): string =>
  `Attempt ${c.attempt} (${c.stage} gate) feedback:\n${c.note}`;

// Build the messages array for a model drive. Only conclusions whose stage
// matches the requested stage are included — this prevents test-gate feedback
// from leaking into the code drive and vice-versa.
export const buildDriveMessages = (
  kickoff: string,
  ledger: Ledger,
  stage: 'test' | 'code'
): readonly ModelMessage[] => {
  const matching = ledger.filter((c): boolean => c.stage === stage);
  if (matching.length === 0) {
    return [{ role: 'user', content: kickoff }];
  }
  const notes = matching.map(formatConclusionNote).join('\n\n');
  return [{ role: 'user', content: `${kickoff}\n\n${notes}` }];
};
