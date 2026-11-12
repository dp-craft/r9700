import type { ReactElement } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useSkillStore } from '@/features/skills';
import { useTranslation } from '@/i18n';

import { useSettingsStore } from '../stores/useSettingsStore';

const NO_SKILLS_VALUE = '__none__';

type ContainerOption = { readonly value: string; readonly label: string };

function buildContainerOptions(
  containers: readonly { readonly id: string; readonly name: string }[]
): readonly ContainerOption[] {
  return containers.map(c => ({ value: c.id, label: c.name }));
}

function resolveSelectValue(defaultContainerId: string | null): string {
  return defaultContainerId ?? NO_SKILLS_VALUE;
}

function resolveContainerId(value: string): string | null {
  return value === NO_SKILLS_VALUE ? null : value;
}

export function DefaultContainerPickerContainer(): ReactElement {
  const t = useTranslation();
  const defaultContainerId = useSettingsStore(s => s.defaultContainerId);
  const setDefaultContainerId = useSettingsStore(s => s.setDefaultContainerId);
  const containers = useSkillStore(s => s.containers);

  const containerOptions = buildContainerOptions(containers);
  const selectValue = resolveSelectValue(defaultContainerId);

  const handleValueChange = (value: string): void => {
    setDefaultContainerId(resolveContainerId(value));
  };

  const label = t('settings.defaultContainerLabel');
  const ariaLabel = t('settings.defaultContainerSelectAria');
  const placeholder = t('settings.defaultContainerPlaceholder');
  const heading = t('settings.defaultContainerHeading');

  return (
    <section aria-labelledby="settings-default-container-heading" className="flex flex-col gap-3">
      <h3
        id="settings-default-container-heading"
        className="text-muted-foreground text-sm font-medium"
      >
        {heading}
      </h3>
      <div className="flex flex-col gap-2">
        <Label htmlFor="default-container-select">{label}</Label>
        <Select value={selectValue} onValueChange={handleValueChange}>
          <SelectTrigger id="default-container-select" aria-label={ariaLabel}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            <SelectItem value={NO_SKILLS_VALUE}>{placeholder}</SelectItem>
            {containerOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
