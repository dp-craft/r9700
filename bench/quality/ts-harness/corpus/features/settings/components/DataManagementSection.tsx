import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DataManagementLabels {
  readonly title: string;
  readonly description: string;
  readonly exportButton: string;
  readonly importButton: string;
  readonly exportingLabel: string;
  readonly importingLabel: string;
}

export interface DataManagementSectionProps {
  readonly onExport: () => void;
  readonly onImport: () => void;
  readonly isExporting: boolean;
  readonly isImporting: boolean;
  readonly labels: DataManagementLabels;
  readonly className?: string;
}

function getExportButtonText(labels: DataManagementLabels, isExporting: boolean): string {
  return isExporting ? labels.exportingLabel : labels.exportButton;
}

function getImportButtonText(labels: DataManagementLabels, isImporting: boolean): string {
  return isImporting ? labels.importingLabel : labels.importButton;
}

export function DataManagementSection({
  onExport,
  onImport,
  isExporting,
  isImporting,
  labels,
  className,
}: DataManagementSectionProps): React.ReactElement {
  const isBusy = isExporting || isImporting;
  const exportText = getExportButtonText(labels, isExporting);
  const importText = getImportButtonText(labels, isImporting);

  return (
    <section className={cn('space-y-4', className)} aria-labelledby="data-management-title">
      <h3 id="data-management-title" className="text-muted-foreground text-sm font-medium">
        {labels.title}
      </h3>
      <p className="text-muted-foreground text-sm">{labels.description}</p>
      <div className="flex gap-2">
        <Button variant="outline" disabled={isBusy} onClick={onExport} aria-label={exportText}>
          {exportText}
        </Button>
        <Button variant="outline" disabled={isBusy} onClick={onImport} aria-label={importText}>
          {importText}
        </Button>
      </div>
    </section>
  );
}
