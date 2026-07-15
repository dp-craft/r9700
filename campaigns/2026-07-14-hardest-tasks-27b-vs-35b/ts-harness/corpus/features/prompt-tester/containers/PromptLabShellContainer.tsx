import { type ReactElement, type ReactNode, useEffect } from 'react';

import { MFLayout } from '@/components/ui/MFLayout';
import { MfLayoutSkeleton } from '@/components/ui/MfLayoutSkeleton';
import { useTranslation } from '@/i18n';
import { MFRail, SkillsPanelContainer, useMFRailItems } from '@/shell';
import { type LabPanel, useUIStore } from '@/stores/useUIStore';

import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import { LeftColumnContainer } from './LeftColumnContainer';
import { PromptHistoryPanelHost } from './PromptHistoryPanelHost';
import { RightColumnContainer } from './RightColumnContainer';
import { RunHistoryPanelHost } from './RunHistoryPanelHost';
import { RunTabsContainer } from './RunTabsContainer';

const TesterPanel = (): ReactElement => {
  const t = useTranslation();
  return (
    <MfLayoutSkeleton
      headerSlot={<RunTabsContainer />}
      leftColumnSlot={<LeftColumnContainer />}
      rightColumnSlot={<RightColumnContainer />}
      leftColumnAriaLabel={t('lab.layout.leftColumnAria')}
      rightColumnAriaLabel={t('lab.layout.rightColumnAria')}
    />
  );
};

const PANEL_BODY: Record<LabPanel, ReactNode> = {
  tester: <TesterPanel />,
  'run-history': <RunHistoryPanelHost />,
  'prompt-history': <PromptHistoryPanelHost />,
  skills: <SkillsPanelContainer />,
};

export function PromptLabShellContainer(): ReactElement {
  const rail = useMFRailItems();
  const labPanel = useUIStore(s => s.labPanel);
  const pendingLabRunId = useUIStore(s => s.pendingLabRunId);
  const setPendingLabRunId = useUIStore(s => s.setPendingLabRunId);
  const loadRunHistory = usePromptTesterStore(s => s.loadRunHistory);
  const openArchivedRunById = usePromptTesterStore(s => s.openArchivedRunById);

  // useEffect: store-load — initial labRuns hydration (FR-032, T113)

  useEffect(() => {
    void loadRunHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Zustand action refs are stable; empty deps per UI.md store-load rule
  }, []);

  // useEffect: subscribe — consume pendingLabRunId from UIStore (cross-feature dispatch)
  useEffect(() => {
    if (pendingLabRunId === null) return;
    setPendingLabRunId(null);
    void openArchivedRunById(pendingLabRunId);
  }, [pendingLabRunId, setPendingLabRunId, openArchivedRunById]);

  const handlePanelChange = (panelKey: string): void => {
    rail.onSelect(panelKey);
  };

  return (
    <MFLayout
      leftRailSlot={(
        <MFRail
          items={rail.items}
          activePanelKey={rail.activePanelKey}
          onPanelChange={handlePanelChange}
        />
      )}
    >
      {PANEL_BODY[labPanel]}
    </MFLayout>
  );
}
