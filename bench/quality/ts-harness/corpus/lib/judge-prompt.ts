export interface JudgeRequest {
  readonly userPrompt: string;
  readonly responseText: string;
  readonly systemPrompt: string | null;
}

export interface ComparisonRequest {
  readonly comparisonInstruction: string;
  readonly userPrompt: string;
  readonly systemPrompt: string | null;
  readonly outputs: readonly ComparisonOutput[];
}

export interface ComparisonOutput {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

interface JudgePromptResult {
  readonly systemMessage: string;
  readonly userMessage: string;
}

export const JUDGE_RUBRIC_SYSTEM = `You are an expert LLM response evaluator. Score the given response on a 1-4 scale across 5 criteria:

1 = Poor, 2 = Below Average, 3 = Good, 4 = Excellent

Criteria:
- Relevance: How well the response addresses the user's prompt
- Coherence: Logical flow and structure of the response
- Completeness: Whether the response fully covers the topic
- Helpfulness: Practical value and usefulness to the user
- Conciseness: Brevity without sacrificing important content

Respond ONLY with valid JSON in this exact format:
{"score": <overall 1-4>, "criteria": [{"name": "<criterion>", "score": <1-4>, "reasoning": "<brief explanation>"}], "overallReasoning": "<summary>"}

`;

export const COMPARISON_SYSTEM_PROMPT = `You are an expert LLM response evaluator. Compare and rank the provided outputs against the original prompt and system prompts. Each output is labelled with a stable identifier — reference outputs by their label.

Respond ONLY with valid JSON in this exact format:
{"ranking": [{"label": "<output-label>", "cellId": "<the output's identifier>", "rank": <1-based position>, "reasoning": "<brief explanation>"}], "winnerLabel": "<label-of-best-output>", "overallReasoning": "<summary>"}`;

const COMPARISON_SECTION_SEP = '\n\n---\n\n';

export const buildSystemPromptSection = (systemPrompt: string): string =>
  `\n\n[System Prompt Context]\n${systemPrompt}`;

const buildUserMessageContent = (request: JudgeRequest): string =>
  `[User Prompt]\n${request.userPrompt}\n\n[Response to Evaluate]\n${request.responseText}${
    request.systemPrompt !== null ? buildSystemPromptSection(request.systemPrompt) : ''
  }`;

export const buildJudgePrompt = (request: JudgeRequest): JudgePromptResult => ({
  systemMessage: JUDGE_RUBRIC_SYSTEM,
  userMessage: buildUserMessageContent(request),
});

const buildOutputBlock = (output: ComparisonOutput): string =>
  `[${output.label} — id: ${output.id}]\n${output.text}`;

const buildComparisonUserMessage = (request: ComparisonRequest): string => {
  const systemSection =
    request.systemPrompt !== null ? buildSystemPromptSection(request.systemPrompt) : '';
  const outputBlocks = request.outputs.map(buildOutputBlock).join(COMPARISON_SECTION_SEP);
  return `[Comparison Instruction]\n${request.comparisonInstruction}\n\n[User Prompt]\n${request.userPrompt}${systemSection}\n\n[Outputs to Compare]\n${outputBlocks}`;
};

export const buildEvalComparisonPrompt = (request: ComparisonRequest): JudgePromptResult => ({
  systemMessage: COMPARISON_SYSTEM_PROMPT,
  userMessage: buildComparisonUserMessage(request),
});
