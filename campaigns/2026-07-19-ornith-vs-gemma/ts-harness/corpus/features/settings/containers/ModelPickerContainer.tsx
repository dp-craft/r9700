import type * as React from 'react';
import { useCallback } from 'react';

import { useTranslation } from '@/i18n';

import { ModelMetadataPopover } from '../components/ModelMetadataPopover';
import { ModelPicker } from '../components/ModelPicker';
import { useModelList } from '../hooks/useModelList';
import { useSettingsStore } from '../stores/useSettingsStore';
import { buildModelMetadataRows } from '../utils/modelMetadataRows';

export function ModelPickerContainer(): React.ReactElement {
  const t = useTranslation();
  const { models, isLoading, error, contextSize, handleModelChange, handleContextSizeChange } =
    useModelList();

  const activeModelId = useSettingsStore(s => s.activeModelId);
  const activeProviderId = useSettingsStore(s => s.activeProviderId);
  const modelMetadataOpen = useSettingsStore(s => s.modelMetadataOpen);
  const setModelMetadataOpen = useSettingsStore(s => s.setModelMetadataOpen);
  const thinkingEnabled = useSettingsStore(
    s => s.providerConfigs[s.activeProviderId]?.thinkingCapableModels?.[s.activeModelId] ?? false
  );
  const setModelThinkingEnabled = useSettingsStore(s => s.setModelThinkingEnabled);

  const handleInfoOpenChange = useCallback(
    (open: boolean): void => {
      setModelMetadataOpen(open);
    },
    [setModelMetadataOpen]
  );

  const handleViewJson = useCallback((): void => {
    setModelMetadataOpen(true);
  }, [setModelMetadataOpen]);

  const handleThinkingToggle = useCallback((): void => {
    void setModelThinkingEnabled(activeProviderId, activeModelId, !thinkingEnabled);
  }, [setModelThinkingEnabled, activeProviderId, activeModelId, thinkingEnabled]);

  const activeModel = models.find(m => m.id === activeModelId);
  const rows = activeModel
    ? buildModelMetadataRows(activeModel, {
        context: t('settings.modelInfo.context'),
        pricing: t('settings.modelInfo.pricing'),
        modalities: t('settings.modelInfo.modalities'),
        thinking: t('settings.modelInfo.thinking'),
        thinkingValue: t('settings.modelInfo.thinkingValue'),
      })
    : [];

  return (
    <ModelPicker
      models={models}
      activeModelId={activeModelId}
      infoSlot={
        activeModel ? (
          <ModelMetadataPopover
            open={modelMetadataOpen}
            onOpenChange={handleInfoOpenChange}
            title={t('settings.modelInfo.title')}
            rows={rows}
            triggerLabel={t('settings.modelInfo.triggerLabel')}
            supportsThinking={activeModel.supportsThinking}
            thinkingEnabled={thinkingEnabled}
            onThinkingToggle={handleThinkingToggle}
            onViewJson={handleViewJson}
            thinkingLabel={t('settings.modelInfo.thinkingToggleLabel')}
            jsonLabel={t('settings.modelInfo.jsonLabel')}
          />
        ) : undefined
      }
      onModelChange={handleModelChange}
      isLoading={isLoading}
      error={error}
      loadingLabel={t('settings.modelLoading')}
      selectPlaceholder={t('settings.modelSelectPlaceholder')}
      selectModelAria={t('settings.selectModelAria')}
      contextSize={contextSize}
      onContextSizeChange={handleContextSizeChange}
      contextSizeLabel={t('settings.contextSize')}
      contextSizeTooltip={t('settings.contextSizeTooltip')}
    />
  );
}
