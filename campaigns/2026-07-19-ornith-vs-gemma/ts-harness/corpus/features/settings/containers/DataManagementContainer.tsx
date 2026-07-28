import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { useTranslation } from '@/i18n';

import { DataManagementSection } from '../components/DataManagementSection';
import { useDataManagement } from '../hooks/useDataManagement';

export function DataManagementContainer(): ReactElement {
  const t = useTranslation();
  const {
    isExporting,
    isImporting,
    pendingImport,
    fileInputRef,
    labels,
    handleExport,
    handleImportClick,
    handleFileChange,
    handleConfirmImport,
    handleCancelImport,
  } = useDataManagement();

  const handleDialogOpenChange = (open: boolean): void => {
    if (!open) handleCancelImport();
  };

  return (
    <>
      <DataManagementSection
        onExport={() => void handleExport()}
        onImport={handleImportClick}
        isExporting={isExporting}
        isImporting={isImporting}
        labels={labels}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
      <Dialog open={pendingImport !== null} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.importConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('settings.importConfirmMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelImport}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmImport()}>
              {t('settings.importConfirmButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
