import { useSessionStore } from '@/features/sessions';
import { buildModelMetadataRows } from '@/features/settings';
import { useTranslation } from '@/i18n';
import { resolveModelParams } from '@/lib/model-params';
import type { Model } from '@/services/llm/types';

export interface ChatModelDetailsProps {
  readonly supportsThinking: boolean;
  readonly thinkingEnabled: boolean;
  readonly onThinkingToggle: () => void;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly title: string;
  readonly triggerLabel: string;
  readonly thinkingLabel: string;
  readonly jsonLabel: string;
}

export function useChatModelDetails(activeModel: Model | undefined): ChatModelDetailsProps {
  const t = useTranslation();
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const sessionList = useSessionStore(s => s.sessionList);
  const setSessionModelParams = useSessionStore(s => s.setSessionModelParams);

  const activeSession = sessionList.find(s => s.id === activeSessionId);
  const thinkingEnabled = activeSession?.modelParams?.thinkingEnabled === true;

  const onThinkingToggle = (): void => {
    if (!activeSessionId) return;
    const resolved = resolveModelParams(activeSession?.modelParams);
    void setSessionModelParams(activeSessionId, { ...resolved, thinkingEnabled: !thinkingEnabled });
  };

  const rows = activeModel
    ? buildModelMetadataRows(activeModel, {
        context: t('settings.modelInfo.context'),
        pricing: t('settings.modelInfo.pricing'),
        modalities: t('settings.modelInfo.modalities'),
        thinking: t('settings.modelInfo.thinking'),
        thinkingValue: t('settings.modelInfo.thinkingValue'),
      })
    : [];

  return {
    supportsThinking: activeModel?.supportsThinking === true,
    thinkingEnabled,
    onThinkingToggle,
    rows,
    title: t('settings.modelInfo.title'),
    triggerLabel: t('settings.modelInfo.triggerLabel'),
    thinkingLabel: t('settings.modelInfo.thinkingToggleLabel'),
    jsonLabel: t('settings.modelInfo.jsonLabel'),
  };
}
