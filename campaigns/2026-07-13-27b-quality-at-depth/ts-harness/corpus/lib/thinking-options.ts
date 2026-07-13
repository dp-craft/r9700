export interface ThinkingOptions {
  readonly thinkingEnabled?: boolean;
  readonly thinkingBudget?: number;
}

export const THINKING_BUDGET_REQUIRED_PROVIDERS: ReadonlySet<string> = new Set([
  'claude',
  'gemini',
]);

export const buildThinkingOptions = (
  providerId: string,
  thinkingEnabled: boolean | undefined,
  thinkingBudget?: number
): ThinkingOptions => {
  if (!thinkingEnabled) {
    return {};
  }

  if (THINKING_BUDGET_REQUIRED_PROVIDERS.has(providerId)) {
    return thinkingBudget !== undefined ? { thinkingEnabled: true, thinkingBudget } : {};
  }

  return { thinkingEnabled: true };
};
