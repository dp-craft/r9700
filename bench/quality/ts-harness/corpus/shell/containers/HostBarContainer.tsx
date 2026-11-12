import { Bot, Settings } from 'lucide-react';
import type { ReactElement } from 'react';

import { useFeatureFlagStore } from '@/features/settings';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/utils';
import { useUIStore, type Workspace } from '@/stores/useUIStore';

import { HostBar } from '../components/HostBar';
import { MF_REGISTRY } from '../constants';
import type { MFMeta } from '../types';
import { BackgroundStreamIndicatorContainer } from './BackgroundStreamIndicatorContainer';
import { FontSizeSwitchContainer } from './FontSizeSwitchContainer';
import { ThemeSwitchContainer } from './ThemeSwitchContainer';

const MF_PILLS: readonly MFMeta[] = Object.values(MF_REGISTRY);

const WORKSPACE_ACCENT: Record<Workspace, 'blue' | 'purple'> = {
  chat: 'blue',
  'prompt-lab': 'purple',
};

const getSegmentClass = (isActive: boolean): string =>
  cn(
    'inline-flex items-center gap-2 rounded-none border-0 px-3 h-8 transition-colors',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'
  );

const makeSettingsHandler = (openDialog: (d: 'settings') => void) => (): void =>
  openDialog('settings');

export const HostBarContainer = (): ReactElement => {
  const t = useTranslation();
  const workspace = useUIStore(s => s.workspace);
  const setWorkspace = useUIStore(s => s.setWorkspace);
  const openDialog = useUIStore(s => s.openDialog);
  const labEnabled = useFeatureFlagStore(s => s.flags['prompt-lab-enabled']);

  const handleSelectWorkspace = (id: Workspace) => (): void => setWorkspace(id);

  const logoSlot = (
    <div className="flex items-center gap-2">
      <Bot className="h-5 w-5" aria-hidden="true" />
      <span className="text-sm font-semibold">{t('shell.appName')}</span>
    </div>
  );

  const pillsSlot = (
    <div className="inline-flex items-center overflow-hidden rounded-md border border-border">
      {MF_PILLS.map(meta => {
        if (meta.id === 'prompt-lab' && labEnabled === false) {
          return null;
        }
        const isActive = workspace === meta.id;
        const Icon = meta.icon;
        return (
          <button
            key={meta.id}
            type="button"
            onClick={handleSelectWorkspace(meta.id)}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`mf-pill-${meta.id}`}
            className={getSegmentClass(isActive)}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[720px]:inline text-sm">{t(meta.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );

  const settingsSlot = (
    <button
      type="button"
      onClick={makeSettingsHandler(openDialog)}
      aria-label={t('shell.openSettings')}
      data-testid="settings-button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
    >
      <Settings className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <HostBar
      accentColor={WORKSPACE_ACCENT[workspace]}
      logoSlot={logoSlot}
      pillsSlot={pillsSlot}
      indicatorSlot={<BackgroundStreamIndicatorContainer />}
      fontSizeSlot={<FontSizeSwitchContainer />}
      themeSwitchSlot={<ThemeSwitchContainer />}
      settingsSlot={settingsSlot}
    />
  );
};
