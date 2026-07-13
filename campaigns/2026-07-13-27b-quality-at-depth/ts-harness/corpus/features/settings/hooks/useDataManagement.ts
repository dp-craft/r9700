import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useSessionStore } from '@/features/sessions';
import { useSkillStore } from '@/features/skills';
import { useTranslation } from '@/i18n';

import type { DataManagementLabels } from '../components/DataManagementSection';
import type { DatabaseExport } from '../stores/useSettingsStore';
import { useSettingsStore } from '../stores/useSettingsStore';

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildBackupFilename(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `aichatney-backup-${date}.json`;
}

async function reloadAllStores(): Promise<void> {
  await useSettingsStore.getState().loadProviderConfigs();
  await useSettingsStore.getState().loadLanguageSettings();
  await useSettingsStore.getState().loadEncryptionMetadata();
  await useSessionStore.getState().loadSessions();
  await useSkillStore.getState().loadSkills();
  await useSkillStore.getState().loadContainers();
}

export interface DataManagementState {
  readonly isExporting: boolean;
  readonly isImporting: boolean;
  readonly pendingImport: DatabaseExport | null;
  readonly fileInputRef: React.RefObject<HTMLInputElement | null>;
  readonly labels: DataManagementLabels;
  readonly handleExport: () => Promise<void>;
  readonly handleImportClick: () => void;
  readonly handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  readonly handleConfirmImport: () => Promise<void>;
  readonly handleCancelImport: () => void;
}

export function useDataManagement(): DataManagementState {
  const t = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<DatabaseExport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async (): Promise<void> => {
    setIsExporting(true);
    try {
      const data = await useSettingsStore.getState().exportAllData();
      downloadJson(data, buildBackupFilename());
      toast.success(t('settings.exportSuccess'));
    } catch {
      toast.error(t('settings.exportError'));
    } finally {
      setIsExporting(false);
    }
  }, [t]);

  const handleImportClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (): void => {
        try {
          const parsed: unknown = JSON.parse(reader.result as string);
          const validation = useSettingsStore.getState().validateImportData(parsed);
          if (!validation.valid) {
            toast.error(t('settings.importInvalidFile'));
            return;
          }
          setPendingImport(parsed as DatabaseExport);
        } catch {
          toast.error(t('settings.importInvalidFile'));
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [t]
  );

  const handleConfirmImport = useCallback(async (): Promise<void> => {
    if (!pendingImport) return;
    setIsImporting(true);
    setPendingImport(null);
    try {
      await useSettingsStore.getState().importAllData(pendingImport);
      await reloadAllStores();
      toast.success(t('settings.importSuccess'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(t('settings.importError', { error: message }));
    } finally {
      setIsImporting(false);
    }
  }, [pendingImport, t]);

  const handleCancelImport = useCallback((): void => {
    setPendingImport(null);
  }, []);

  const labels: DataManagementLabels = {
    title: t('settings.dataManagement'),
    description: t('settings.dataManagementDesc'),
    exportButton: t('settings.exportData'),
    importButton: t('settings.importData'),
    exportingLabel: t('settings.exporting'),
    importingLabel: t('settings.importing'),
  };

  return {
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
  };
}
