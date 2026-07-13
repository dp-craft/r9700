import type React from 'react';

import { Pill } from '@/components/ui/Pill';
import { Section } from '@/components/ui/Section';
import { useSettingsStore } from '@/features/settings';
import { useSkillStore } from '@/features/skills';
import { useTranslation } from '@/i18n';

import { ModelPickerDialog } from '../components/ModelPickerDialog';
import { RunBar } from '../components/RunBar';
import { SystemPromptEntry } from '../components/SystemPromptEntry';
import { TestPromptSection } from '../components/TestPromptSection';
import { UserPromptHistoryDropdown } from '../components/UserPromptHistoryDropdown';
import { ModelCardContainer } from '../containers/ModelCardContainer';
import { PromptPickerDialogContainer } from '../containers/PromptPickerDialogContainer';
import { SystemPromptEditDialogContainer } from '../containers/SystemPromptEditDialogContainer';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import type { ModelOptionVM, PromptEntry, SectionId } from '../types';
import { promptAxisMap } from '../utils/cellAxisIds';
import { useModelGroups } from './useModelGroups';

interface ContainerLike {
  readonly id: string;
  readonly name: string;
  readonly skillIds: readonly string[];
}

function resolvePackageLabel(
  prompt: PromptEntry,
  containers: readonly ContainerLike[],
  packageMetaPrefix: string
): string | undefined {
  if (prompt.containerId !== undefined) {
    const containerName = containers.find(c => c.id === prompt.containerId)?.name;
    return containerName !== undefined ? `${packageMetaPrefix}${containerName}` : undefined;
  }
  const { skillId } = prompt;
  if (prompt.kind === 'skill' && skillId !== undefined) {
    const containerName = containers.find(c => c.skillIds.includes(skillId))?.name;
    return containerName !== undefined ? `${packageMetaPrefix}${containerName}` : undefined;
  }
  return undefined;
}

interface LeftColumnSlots {
  readonly modellekSection: React.ReactNode;
  readonly systemSkillSection: React.ReactNode;
  readonly userPromptSection: React.ReactNode;
  readonly runBar: React.ReactNode;
}

export function useLeftColumnSections(): LeftColumnSlots {
  const t = useTranslation();
  const models = usePromptTesterStore(s => s.models);
  const prompts = usePromptTesterStore(s => s.prompts);
  const userPrompt = usePromptTesterStore(s => s.userPrompt);
  const sectionCollapse = usePromptTesterStore(s => s.sectionCollapse);
  const toggleSection = usePromptTesterStore(s => s.toggleSection);
  const setUserPrompt = usePromptTesterStore(s => s.setUserPrompt);
  const runFull = usePromptTesterStore(s => s.runFull);
  const runChanged = usePromptTesterStore(s => s.runChanged);
  const abortRun = usePromptTesterStore(s => s.abortRun);
  const runParallel = usePromptTesterStore(s => s.runParallel);
  const setRunParallel = usePromptTesterStore(s => s.setRunParallel);
  const isRunning = usePromptTesterStore(s => s.streaming.runId !== null);
  const hasChanges = usePromptTesterStore(s => s.hasOutdatedCells());
  const openPicker = usePromptTesterStore(s => s.openPicker);
  const modelPickerOpen = usePromptTesterStore(s => s.modelPickerOpen);
  const openModelPicker = usePromptTesterStore(s => s.openModelPicker);
  const closeModelPicker = usePromptTesterStore(s => s.closeModelPicker);
  const confirmModelPicker = usePromptTesterStore(s => s.confirmModelPicker);
  const removePrompt = usePromptTesterStore(s => s.removePrompt);
  const setEditingPrompt = usePromptTesterStore(s => s.setEditingPrompt);
  const userPromptHistoryOpen = usePromptTesterStore(s => s.userPromptHistoryOpen);
  const userPromptHistoryItems = usePromptTesterStore(s => s.userPromptHistoryItems);
  const setUserPromptHistoryOpen = usePromptTesterStore(s => s.setUserPromptHistoryOpen);
  const selectUserPromptHistory = usePromptTesterStore(s => s.selectUserPromptHistory);
  const loadUserPromptHistory = usePromptTesterStore(s => s.loadUserPromptHistory);
  const skills = useSkillStore(s => s.skills);
  const containers = useSkillStore(s => s.containers);
  const modelGroups = useModelGroups();
  const promptAxisLabels = promptAxisMap(prompts);

  const handleToggle = (id: SectionId) => (): void => toggleSection(id);
  const handleRemovePrompt = (index: number): void => {
    const prompt = prompts[index - 1];
    if (prompt) removePrompt(prompt.id);
  };
  const handleEntryClick = (id: string): void => {
    setEditingPrompt(id);
  };
  const handleOpenPicker = (): void => {
    void openPicker(skills);
  };
  const handleHistoryOpenChange = (open: boolean): void => {
    setUserPromptHistoryOpen(open);
    if (open) {
      void loadUserPromptHistory();
    }
  };
  const handleOpenModelPicker = (): void => openModelPicker();
  const handleModelPickerOpenChange = (open: boolean): void => {
    if (!open) closeModelPicker();
  };
  const handleModelSelect = async (model: ModelOptionVM): Promise<void> => {
    let supportsThinking = model.supportsThinking;
    if (model.providerId === 'ollama') {
      const known =
        useSettingsStore.getState().providerConfigs.ollama?.thinkingCapableModels?.[model.modelKey];
      if (known === undefined) {
        await useSettingsStore
          .getState()
          .detectAndPersistThinkingCapability('ollama', model.modelKey);
        supportsThinking =
          useSettingsStore.getState().providerConfigs.ollama?.thinkingCapableModels?.[
            model.modelKey
          ] ?? false;
      }
    }
    confirmModelPicker({
      providerId: model.providerId,
      modelKey: model.modelKey,
      name: model.name,
      supportsThinking,
    });
  };

  const modellekSection = (
    <>
      <Section
        title={t('lab.section.models')}
        count={models.length}
        collapsed={sectionCollapse.modellek}
        bodyId="section-modellek"
        onToggleCollapse={handleToggle('modellek')}
        action={(
          <Pill
            accent
            filled
            role="button"
            tabIndex={0}
            aria-label={t('lab.action.addModel')}
            onClick={handleOpenModelPicker}
          >
            {t('lab.action.addModel')}
          </Pill>
        )}
      >
        {models.map(m => (
          <ModelCardContainer key={m.id} modelId={m.id} />
        ))}
      </Section>
      <ModelPickerDialog
        open={modelPickerOpen}
        onOpenChange={handleModelPickerOpenChange}
        groups={modelGroups}
        onSelect={handleModelSelect}
        labels={{
          title: t('lab.modelPicker.title'),
          search: t('lab.modelPicker.search'),
          empty: t('lab.modelPicker.empty'),
        }}
      />
    </>
  );

  const systemSkillSection = (
    <>
      <Section
        title={t('lab.section.systemSkill')}
        count={prompts.length}
        collapsed={sectionCollapse.systemSkill}
        bodyId="section-system-skill"
        onToggleCollapse={handleToggle('systemSkill')}
        action={(
          <Pill
            accent
            filled
            role="button"
            tabIndex={0}
            aria-label={t('lab.action.addPrompt')}
            onClick={handleOpenPicker}
          >
            {t('lab.action.addPrompt')}
          </Pill>
        )}
      >
        {prompts.map((p, i) => (
          <SystemPromptEntry
            key={p.id}
            id={p.id}
            index={i + 1}
            kind={p.kind === 'skill' ? 'skill' : 'manual'}
            skillName={
              p.kind === 'skill' ? (skills.find(s => s.id === p.skillId)?.name ?? '') : undefined
            }
            label={resolvePackageLabel(p, containers, t('lab.entry.package-meta'))}
            preview={p.text}
            axisLabel={promptAxisLabels[p.id]}
            onRemove={handleRemovePrompt}
            onEntryClick={handleEntryClick}
            labels={{
              remove: t('lab.entry.remove'),
              editedBy: t('lab.entry.edited-meta'),
              skillMeta: t('lab.entry.skill-meta'),
            }}
          />
        ))}
      </Section>
      <PromptPickerDialogContainer />
      <SystemPromptEditDialogContainer />
    </>
  );

  const historyDropdownItems = userPromptHistoryItems.map(entry => ({
    runId: entry.id,
    prompt: entry.text,
    recordedAt: entry.lastUsedAt,
  }));

  const historyDropdownLabels = {
    historyTrigger: t('lab.body.user-history'),
    empty: t('lab.body.history.empty'),
    ariaLabel: t('lab.body.history.aria'),
  };

  const userPromptSection = (
    <Section
      title={t('lab.section.userPrompt')}
      collapsed={sectionCollapse.userPrompt}
      bodyId="section-user-prompt"
      onToggleCollapse={handleToggle('userPrompt')}
      action={(
        <UserPromptHistoryDropdown
          items={historyDropdownItems}
          onSelect={selectUserPromptHistory}
          open={userPromptHistoryOpen}
          onOpenChange={handleHistoryOpenChange}
          labels={historyDropdownLabels}
        />
      )}
    >
      <TestPromptSection
        value={userPrompt}
        onChange={setUserPrompt}
        tokens={Math.ceil(userPrompt.length / 4)}
        maxTokens={2048}
        placeholder={t('lab.userPrompt.placeholder')}
        ariaLabel={t('lab.userPrompt.aria')}
        variableChipLabel={t('lab.userPrompt.chipVariable')}
        fileChipLabel={t('lab.userPrompt.chipFile')}
        tokenUnitLabel={t('lab.userPrompt.tokenUnit')}
      />
    </Section>
  );

  const totalCells = models.length * prompts.length * (userPrompt.trim() ? 1 : 0);
  const formulaLabel = t('lab.runBar.formula', {
    m: String(models.length),
    s: String(prompts.length),
    u: String(userPrompt.trim() ? 1 : 0),
    cells: String(totalCells),
  });

  const runBar = (
    <RunBar
      formulaLabel={formulaLabel}
      runParallel={runParallel}
      onToggleParallel={setRunParallel}
      parallelTooltip={t('lab.runBar.parallelTooltip')}
      hasChanges={hasChanges}
      isRunning={isRunning}
      onRunAll={runFull}
      onRunChanged={runChanged}
      onAbort={abortRun}
      labels={{
        runAll: t('lab.runBar.runAll'),
        runChanged: t('lab.runBar.runChanged'),
        parallelOn: t('lab.runBar.parallelOn'),
        abort: t('lab.runBar.abort'),
      }}
    />
  );

  return { modellekSection, systemSkillSection, userPromptSection, runBar };
}
