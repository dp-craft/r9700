export const shouldShowModelBadge = (
  currentModel: string | undefined,
  previousAssistantModel: string | undefined,
  isFirstAssistantMessage: boolean
): boolean => {
  if (currentModel === undefined) return false;
  if (isFirstAssistantMessage) return true;
  if (previousAssistantModel === undefined) return true;
  return currentModel !== previousAssistantModel;
};
