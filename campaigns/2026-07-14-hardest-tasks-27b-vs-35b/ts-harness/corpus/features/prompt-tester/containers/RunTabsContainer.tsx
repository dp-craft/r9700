import { Pencil } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { RunTabs } from '@/components/ui/RunTabs';
import { useTranslation } from '@/i18n/useTranslation';

import { ResultsViewToggle } from '../components/ResultsViewToggle';
import { useRunTabsContainerProps } from '../hooks/useRunTabsContainerProps';

export function RunTabsContainer(): ReactElement {
  const t = useTranslation();
  const props = useRunTabsContainerProps();

  const menuSlot = (id: string): ReactNode => (
    <Button
      variant="ghost"
      size="icon"
      className="h-5 w-5"
      aria-label={t('lab.tabs.rename')}
      onClick={props.handleRenameClick(id)}
    >
      <Pencil className="h-3 w-3" />
    </Button>
  );

  return (
    <RunTabs
      tabs={props.tabs}
      activeId={props.activeId}
      editingId={props.editingId}
      canCloseActive={props.canCloseActive}
      addLabel={t('lab.tabs.new-test')}
      onActivate={props.onActivate}
      onClose={props.onClose}
      onRenameStart={props.onRenameStart}
      onRenameCommit={props.onRenameCommit}
      onRenameCancel={props.onRenameCancel}
      onAdd={props.onAdd}
      endSlot={(
        <ResultsViewToggle
          viewMode={props.viewMode}
          onChange={props.setViewMode}
          labels={{ list: t('lab.view.list'), grid: t('lab.view.grid') }}
        />
      )}
      menuSlot={menuSlot}
    />
  );
}
