import { buildModelMetadataRows, ModelMetadataPopover } from '@/features/settings';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';

import { ModelCard } from '../components/ModelCard';
import { RemoveLastModelDialog } from '../components/RemoveLastModelDialog';
import { useModelCardActions } from '../hooks/useModelCardActions';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';

export interface ModelCardContainerProps {
  readonly modelId: string;
}

export const ModelCardContainer = ({
  modelId,
}: ModelCardContainerProps): React.ReactElement | null => {
  const t = useTranslation();
  const entry = usePromptTesterStore(s => s.models.find(m => m.id === modelId));
  const actions = useModelCardActions(modelId);

  if (!entry) return null;

  const metadataRows = buildModelMetadataRows(
    { id: entry.id, name: entry.name, supportsThinking: entry.supportsThinking },
    {
      context: t('settings.modelInfo.context'),
      pricing: t('settings.modelInfo.pricing'),
      modalities: t('settings.modelInfo.modalities'),
      thinking: t('settings.modelInfo.thinking'),
      thinkingValue: t('settings.modelInfo.thinkingValue'),
    }
  );

  const infoSlot = (
    <ModelMetadataPopover
      title={t('settings.modelInfo.title')}
      triggerLabel={t('settings.modelInfo.triggerLabel')}
      rows={metadataRows}
      triggerTestId="lab-model-details"
      supportsThinking={entry.supportsThinking}
      thinkingEnabled={entry.thinking}
      onThinkingToggle={actions.handleToggleThinking}
      onViewJson={actions.handleToggleExpanded}
      thinkingLabel={t('settings.modelInfo.thinkingToggleLabel')}
      jsonLabel={t('lab.modelCard.json')}
    />
  );

  return (
    <>
      <ModelCard
        entry={entry}
        onSetParam={actions.handleSetParam}
        onClampParam={actions.handleClampParam}
        onToggleThinking={actions.handleToggleThinking}
        onToggleExpanded={actions.handleToggleExpanded}
        onClose={actions.handleClose}
        infoSlot={infoSlot}
        labels={{
          thinking: t('lab.modelCard.thinking'),
          thinkingOn: t('lab.modelCard.thinkingOn'),
          legend: t('lab.modelParameters'),
          paramLabels: {
            temp: t('lab.modelCard.param.temp'),
            topP: t('lab.modelCard.param.topP'),
            maxTok: t('lab.modelCard.param.maxTok'),
            freq: t('lab.modelCard.param.freq'),
            pres: t('lab.modelCard.param.pres'),
            contextSize: t('lab.modelCard.param.contextSize'),
          },
          cardAria: (name: string) => t('lab.modelCard.cardAria', { name }),
          toggleAria: (name: string) => t('lab.modelCard.toggleAria', { name }),
          removeAria: (name: string) => t('lab.modelCard.removeAria', { name }),
        }}
        className={cn(actions.amberFlash && 'border-amber-500')}
      />
      <RemoveLastModelDialog
        open={actions.showConfirm}
        onOpenChange={actions.setShowConfirm}
        onConfirm={actions.handleConfirmRemove}
        title={t('lab.confirm.removeLastModelTitle')}
        description={t('lab.confirm.removeLastModel')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
      />
    </>
  );
};
