import { Settings2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ModelParamsDTO } from '@/domain/entities';
import { useSessionStore } from '@/features/sessions';
import { useTranslation } from '@/i18n';
import type { ModelParams, ParamRanges } from '@/lib/model-params';
import { clampParam, isAtDefaults, resolveModelParams } from '@/lib/model-params';
import { cn } from '@/lib/utils';

import { ModelParamsPopover } from '../components/ModelParamsPopover';

export interface ModelParamsPopoverContainerProps {
  readonly supportsThinking: boolean;
}

type SetParams = (id: string, p: ModelParamsDTO) => Promise<void>;
type PKey = keyof ParamRanges;

function paramHandler(id: string, cur: ModelParams, set: SetParams, key: PKey) {
  return (value: number): void => {
    void set(id, { ...cur, [key]: clampParam(key, value) });
  };
}

export function ModelParamsPopoverContainer({
  supportsThinking,
}: ModelParamsPopoverContainerProps): React.JSX.Element | null {
  const t = useTranslation();
  const sessionId = useSessionStore(s => s.activeSessionId);
  const modelParams = useSessionStore(
    s => s.sessionList.find(sess => sess.id === s.activeSessionId)?.modelParams
  );
  const setParams = useSessionStore(s => s.setSessionModelParams);
  const resetParams = useSessionStore(s => s.resetSessionModelParams);

  const resolved = resolveModelParams(modelParams);
  const atDefaults = isAtDefaults(modelParams);

  const labels = useMemo(
    () => ({
      temperature: t('chat.temperature'),
      maxTokens: t('chat.maxTokens'),
      topP: t('chat.topP'),
      contextSize: t('chat.contextSize'),
      thinking: t('chat.thinking'),
      thinkingBudget: t('chat.thinkingBudget'),
      resetToDefaults: t('chat.resetToDefaults'),
      temperatureTooltip: t('chat.temperatureTooltip'),
      maxTokensTooltip: t('chat.maxTokensTooltip'),
      topPTooltip: t('chat.topPTooltip'),
      contextSizeTooltip: t('chat.contextSizeTooltip'),
      thinkingTooltip: t('chat.thinkingTooltip'),
      thinkingBudgetTooltip: t('chat.thinkingBudgetTooltip'),
    }),
    [t]
  );

  const handleThinkingChange = useCallback(
    (enabled: boolean): void => {
      if (!sessionId) return;
      void setParams(sessionId, { ...resolved, thinkingEnabled: enabled });
    },
    [sessionId, resolved, setParams]
  );

  const handleReset = useCallback((): void => {
    if (!sessionId) return;
    void resetParams(sessionId);
  }, [sessionId, resetParams]);

  if (!sessionId) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-8', atDefaults ? 'text-muted-foreground' : 'text-primary')}
          aria-label={t('chat.modelParameters')}
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end" sideOffset={4}>
        <ModelParamsPopover
          temperature={resolved.temperature}
          maxTokens={resolved.maxTokens}
          topP={resolved.topP}
          thinkingEnabled={resolved.thinkingEnabled}
          thinkingBudget={resolved.thinkingBudget}
          supportsThinking={supportsThinking}
          isAtDefaults={atDefaults}
          onTemperatureChange={paramHandler(sessionId, resolved, setParams, 'temperature')}
          onMaxTokensChange={paramHandler(sessionId, resolved, setParams, 'maxTokens')}
          onTopPChange={paramHandler(sessionId, resolved, setParams, 'topP')}
          contextSize={resolved.contextSize}
          onContextSizeChange={paramHandler(sessionId, resolved, setParams, 'contextSize')}
          onThinkingEnabledChange={handleThinkingChange}
          onThinkingBudgetChange={paramHandler(sessionId, resolved, setParams, 'thinkingBudget')}
          onReset={handleReset}
          labels={labels}
        />
      </PopoverContent>
    </Popover>
  );
}
