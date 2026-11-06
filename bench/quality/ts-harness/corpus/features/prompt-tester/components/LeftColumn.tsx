import React from 'react';

import { LEFT_PANEL_WIDTH_REM } from '@/lib/layout-constants';

export interface LeftColumnProps {
  readonly modellekSection: React.ReactNode;
  readonly systemSkillSection: React.ReactNode;
  readonly userPromptSection: React.ReactNode;
  readonly runBar: React.ReactNode;
  readonly isDesktop: boolean;
  readonly desktopOnlyLabel?: string;
}

export const LeftColumn: React.NamedExoticComponent<LeftColumnProps> = React.memo(
  function LeftColumn(props: LeftColumnProps): React.ReactElement {
    if (!props.isDesktop) {
      return (
        <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground text-sm">
          {props.desktopOnlyLabel ?? 'Best viewed on desktop'}
        </div>
      );
    }

    return (
      <div
        className="flex-shrink-0 border-r border-line bg-bg flex flex-col h-full"
        style={{ width: `${LEFT_PANEL_WIDTH_REM}rem` }}
      >
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
          {props.modellekSection}
          {props.systemSkillSection}
          {props.userPromptSection}
        </div>
        <div className="flex-shrink-0">{props.runBar}</div>
      </div>
    );
  }
);
