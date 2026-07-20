import type * as React from 'react';

import { MfLayoutSkeleton } from '@/components/ui/MfLayoutSkeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { SkillsTab } from '../types';

export interface SkillsPageLabels {
  readonly tabContainersLabel: string;
  readonly tabSkillsLabel: string;
}

export interface SkillsPageProps {
  readonly activeTab: SkillsTab;
  readonly onTabChange: (tab: string) => void;
  readonly listSlot: React.ReactNode;
  readonly editorSlot: React.ReactNode;
  readonly headerActionSlot?: React.ReactNode;
  readonly leftColumnAriaLabel: string;
  readonly rightColumnAriaLabel: string;
  readonly labels?: SkillsPageLabels;
  readonly className?: string;
}

const DEFAULT_LABELS: SkillsPageLabels = {
  tabContainersLabel: 'Containers',
  tabSkillsLabel: 'Atomic Skills',
};

export function SkillsPage({
  activeTab,
  onTabChange,
  listSlot,
  editorSlot,
  headerActionSlot,
  leftColumnAriaLabel,
  rightColumnAriaLabel,
  labels = DEFAULT_LABELS,
  className,
}: SkillsPageProps): React.ReactElement {
  const headerSlot = (
    <div className="flex items-center justify-between gap-2 px-4 py-3">
      <TabsList className="bg-muted/80 gap-1 border border-border p-1">
        <TabsTrigger
          value="containers"
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-4"
        >
          {labels.tabContainersLabel}
        </TabsTrigger>
        <TabsTrigger
          value="skills"
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md px-4"
        >
          {labels.tabSkillsLabel}
        </TabsTrigger>
      </TabsList>
      {headerActionSlot}
    </div>
  );

  const rightColumnSlot = (
    <div
      data-testid="skills-editor-panel"
      className="bg-background flex min-w-0 w-full flex-1 flex-col overflow-hidden p-4"
    >
      {editorSlot}
    </div>
  );

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="flex h-full w-full flex-col">
      <MfLayoutSkeleton
        headerSlot={headerSlot}
        leftColumnSlot={listSlot}
        rightColumnSlot={rightColumnSlot}
        leftColumnAriaLabel={leftColumnAriaLabel}
        rightColumnAriaLabel={rightColumnAriaLabel}
        className={className}
      />
    </Tabs>
  );
}
