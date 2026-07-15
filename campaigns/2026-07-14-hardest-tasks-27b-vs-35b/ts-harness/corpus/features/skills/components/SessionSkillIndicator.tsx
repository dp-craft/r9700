import type * as React from 'react';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface SessionSkillIndicatorLabels {
  readonly skillSetLabel: string;
  readonly changeAriaLabel: string;
  readonly selectSkillSetLabel: string;
  readonly noSkillsInContainerLabel: string;
  readonly noSkillsActiveLabel: string;
  readonly noSkillsOptionLabel: string;
  readonly approximateTokenCountSuffix: string;
  readonly skillCountSingularLabel: string;
  readonly skillCountPluralLabel: string;
  readonly packagesSectionLabel?: string;
  readonly individualSkillsSectionLabel?: string;
}

export interface IndividualSkillOption {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
}

export interface SessionSkillIndicatorProps {
  readonly selectedValue: string;
  readonly onSelect: (value: string) => void;
  readonly containers: readonly { readonly id: string; readonly name: string }[];
  readonly individualSkills?: readonly IndividualSkillOption[];
  readonly skillNames: readonly string[];
  readonly tokenCount: number;
  readonly labels?: SessionSkillIndicatorLabels;
  readonly className?: string;
}

const NO_SKILLS_SENTINEL = '__none__' as const;

const DEFAULT_LABELS: SessionSkillIndicatorLabels = {
  skillSetLabel: 'Skill Set',
  changeAriaLabel: 'Change',
  selectSkillSetLabel: 'Select a skill set',
  noSkillsInContainerLabel: 'No skills in container',
  noSkillsActiveLabel: 'No skills active',
  noSkillsOptionLabel: 'No skills',
  approximateTokenCountSuffix: '~{{count}} tokens',
  skillCountSingularLabel: '1 skill',
  skillCountPluralLabel: '{{count}} skills',
  packagesSectionLabel: 'Packages',
  individualSkillsSectionLabel: 'Individual skills',
};

type ContainerOption = { readonly id: string; readonly name: string };

function renderContainerItem(container: ContainerOption): React.ReactElement {
  return (
    <SelectItem key={container.id} value={`pkg:${container.id}`}>
      {container.name}
    </SelectItem>
  );
}

function renderSkillItem(skill: IndividualSkillOption): React.ReactElement {
  return (
    <SelectItem key={skill.id} value={`skill:${skill.id}`}>
      {skill.name}
    </SelectItem>
  );
}

function formatTokenCount(count: number, suffix: string): string {
  return suffix.replace('{{count}}', count.toLocaleString());
}

export function SessionSkillIndicator({
  selectedValue,
  onSelect,
  containers,
  individualSkills,
  tokenCount,
  labels = DEFAULT_LABELS,
  className,
}: SessionSkillIndicatorProps): React.ReactElement {
  const hasContainers = containers.length > 0;
  const hasIndividualSkills = individualSkills !== undefined && individualSkills.length > 0;

  return (
    <div className={cn('w-full space-y-2', className)}>
      <Select value={selectedValue} onValueChange={onSelect}>
        <SelectTrigger
          aria-label={labels.changeAriaLabel}
          className="bg-background/60 h-8 w-full border px-2 text-sm backdrop-blur-sm"
        >
          <SelectValue placeholder={labels.selectSkillSetLabel} />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          <SelectItem value={NO_SKILLS_SENTINEL}>{labels.noSkillsOptionLabel}</SelectItem>
          {hasContainers ? (
            <SelectGroup>
              <SelectLabel>
                {labels.packagesSectionLabel ?? DEFAULT_LABELS.packagesSectionLabel}
              </SelectLabel>
              {containers.map(renderContainerItem)}
            </SelectGroup>
          ) : null}
          {hasIndividualSkills ? (
            <SelectGroup>
              <SelectLabel>
                {labels.individualSkillsSectionLabel ?? DEFAULT_LABELS.individualSkillsSectionLabel}
              </SelectLabel>
              {individualSkills.map(renderSkillItem)}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      {tokenCount > 0 ? (
        <p className="text-muted-foreground mt-1 truncate px-0.5 text-xs">
          {formatTokenCount(tokenCount, labels.approximateTokenCountSuffix)}
        </p>
      ) : null}
    </div>
  );
}
