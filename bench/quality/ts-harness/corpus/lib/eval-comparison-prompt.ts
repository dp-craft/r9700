// ---------------------------------------------------------------------------
// eval-comparison-prompt
// ---------------------------------------------------------------------------

/** A single candidate output in a comparison request. */
export interface EvalComparisonCandidate {
  readonly cellId: string;
  readonly output: string;
}

/** The input contract for `buildEvalComparisonPrompt`. */
export interface EvalComparisonPromptRequest {
  readonly userPrompt: string;
  readonly systemPrompts: readonly string[];
  readonly candidates: readonly EvalComparisonCandidate[];
}

/** The result of building an evaluation-comparison prompt. */
export interface EvalComparisonPromptResult {
  readonly systemMessage: string;
  readonly userMessage: string;
  readonly labelMap: readonly { readonly label: string; readonly cellId: string }[];
}

// -- Helpers --

const ALL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

/** Convert a zero-based index into a sequential label like `"Output A"`. */
const toLabel = (index: number): string => `Output ${ALL_LABELS[index]}`;

/** Build the label map: each generated label maps to the candidate's cellId. */
const buildLabelMap = (
  candidates: readonly EvalComparisonCandidate[]
): readonly { readonly label: string; readonly cellId: string }[] =>
  candidates.map(
    (c: EvalComparisonCandidate, i: number): { readonly label: string; readonly cellId: string } => ({
      label: toLabel(i),
      cellId: c.cellId,
    })
  );

/** Compose the user message: original prompt + system prompts + labelled outputs. */
const composeUserMessage = (
  userPrompt: string,
  systemPrompts: readonly string[],
  candidates: readonly EvalComparisonCandidate[]
): string => {
  const systemSection = systemPrompts
    .map((p: string): string => `[System Prompt]\n${p}`)
    .join('\n\n');

  const outputsSection = candidates
    .map((c: EvalComparisonCandidate, i: number): string => `### ${toLabel(i)}\n\n${c.output}`)
    .join('\n\n---\n\n');

  const allParts: readonly string[] = [
    userPrompt,
    ...(systemSection !== '' ? [systemSection] : []),
    ...(outputsSection !== '' ? [outputsSection] : []),
  ];

  return allParts.join('\n\n');
};

// -- Constant --

export const EVAL_COMPARISON_SYSTEM: string = `You are an expert LLM response evaluator. Your job is to compare multiple outputs against the same user prompt and (optionally) system prompts, then rank them and select a single winner.

**Evaluation rubric:**
- Relevance: Does the output directly address the user's prompt?
- Completeness: Does it cover all requirements and constraints?
- Quality: Is the response well-structured, clear, and helpful?
- Instruction-following: Does it obey any system prompt directives?

**Instructions:**
1. Review each output carefully.
2. Provide per-criterion reasoning for EVERY output before deciding.
3. Rank ALL outputs from best to worst, showing your ranking order.
4. Declare ONE single winner — the output that best satisfies the prompt and all constraints.

Be objective and thorough. Your reasoning must come BEFORE your verdict.`;

// -- Entry point --

export const buildEvalComparisonPrompt = (
  req: EvalComparisonPromptRequest
): EvalComparisonPromptResult => ({
  systemMessage: EVAL_COMPARISON_SYSTEM,
  userMessage: composeUserMessage(req.userPrompt, req.systemPrompts, req.candidates),
  labelMap: buildLabelMap(req.candidates),
});
