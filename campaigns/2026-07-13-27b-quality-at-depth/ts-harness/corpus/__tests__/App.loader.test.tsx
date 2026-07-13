import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Boundary mocks — declared before imports per Vitest hoisting rules
// ---------------------------------------------------------------------------

vi.mock('@/db/migrations', () => ({
  runV5Migration: vi.fn(),
}));

vi.mock('@/db/skills', () => ({
  seedBuiltinSkills: vi.fn(),
}));

vi.mock('@/features/settings', () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
  useFeatureFlagStore: {
    getState: vi.fn(),
  },
  UnlockModalContainer: () => <div data-testid="unlock-modal" />,
}));

vi.mock('@/features/skills', () => ({
  useSkillStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/features/tutorial', () => ({
  useTutorialStore: {
    getState: vi.fn(),
  },
  TutorialContainer: () => <div data-testid="tutorial-container" />,
}));

vi.mock('@/features/sessions', () => ({
  SessionSidebarContainer: () => <div data-testid="session-sidebar" />,
  SidebarFooterContainer: () => <div data-testid="sidebar-footer" />,
}));

vi.mock('@/shell', () => ({
  ShellLayout: () => <div data-testid="shell" />,
}));

vi.mock('@/features/chat', () => ({
  ChatWindowContainer: () => <div data-testid="chat-window" />,
  ChatShellContainer: () => <div data-testid="chat-shell" />,
  ChatHeaderContainer: () => <div data-testid="chat-header" />,
}));

vi.mock('@/features/prompt-tester', () => ({
  PromptLabShellContainer: () => <div data-testid="prompt-lab-shell" />,
  PromptTesterPageContainer: () => <div data-testid="prompt-tester-page" />,
  usePromptTesterStore: { getState: vi.fn() },
}));

vi.mock('@/features/skills/containers/SessionSkillIndicatorContainer', () => ({
  SessionSkillIndicatorContainer: () => <div data-testid="session-skill-indicator" />,
}));

vi.mock('@/components/BrandingHeader', () => ({
  BrandingHeader: () => <div data-testid="branding-header" />,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn().mockReturnValue(true),
}));

vi.mock('@/i18n', () => ({
  useTranslation: vi.fn().mockReturnValue((key: string) => key),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import * as migrations from '@/db/migrations';
import * as skills from '@/db/skills';
import * as settingsModule from '@/features/settings';
import * as skillsModule from '@/features/skills';
import * as tutorialModule from '@/features/tutorial';
import * as onlineStatusModule from '@/hooks/useOnlineStatus';
import * as i18nModule from '@/i18n';

import App from '../App';

// ---------------------------------------------------------------------------
// Mock function references
// ---------------------------------------------------------------------------

const mockRunV5Migration = migrations.runV5Migration as ReturnType<typeof vi.fn>;
const mockSeedBuiltinSkills = skills.seedBuiltinSkills as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Store action mocks
// ---------------------------------------------------------------------------

const mockLoadAppSettings = vi.fn();
const mockLoadTutorialProgress = vi.fn();
const mockLoadEncryptionMetadata = vi.fn();
const mockLoadProviderConfigs = vi.fn();
const mockLoadFeatureFlags = vi.fn();
const mockLoadContainers = vi.fn();
const mockLoadSkills = vi.fn();

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockRunV5Migration.mockResolvedValue(undefined);
  mockSeedBuiltinSkills.mockResolvedValue(undefined);

  mockLoadAppSettings.mockResolvedValue(undefined);
  mockLoadTutorialProgress.mockResolvedValue(undefined);
  mockLoadEncryptionMetadata.mockResolvedValue(undefined);
  mockLoadProviderConfigs.mockResolvedValue(undefined);
  mockLoadFeatureFlags.mockResolvedValue(undefined);
  mockLoadContainers.mockResolvedValue(undefined);
  mockLoadSkills.mockResolvedValue(undefined);

  (settingsModule.useSettingsStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    loadAppSettings: mockLoadAppSettings,
    loadEncryptionMetadata: mockLoadEncryptionMetadata,
    loadProviderConfigs: mockLoadProviderConfigs,
  });

  (settingsModule.useFeatureFlagStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    loadFeatureFlags: mockLoadFeatureFlags,
  });

  (skillsModule.useSkillStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    loadContainers: mockLoadContainers,
    loadSkills: mockLoadSkills,
  });

  (tutorialModule.useTutorialStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
    loadTutorialProgress: mockLoadTutorialProgress,
  });

  (onlineStatusModule.useOnlineStatus as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (i18nModule.useTranslation as ReturnType<typeof vi.fn>).mockReturnValue((key: string) => key);
});

// ===========================================================================
// Test Suite
// ===========================================================================

describe('App loader sequence (useEffect on mount)', () => {
  // -- runV5Migration --

  describe('runV5Migration', () => {
    it('should call runV5Migration on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockRunV5Migration).toHaveBeenCalledOnce();
      });
    });
  });

  // -- Post-migration loaders --

  describe('loadAppSettings', () => {
    it('should call loadAppSettings after migration completes', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadAppSettings).toHaveBeenCalledOnce();
      });
    });

    it('should not call loadAppSettings before migration resolves', async () => {
      let resolveMigration!: () => void;
      mockRunV5Migration.mockReturnValue(
        new Promise<void>(resolve => {
          resolveMigration = resolve;
        })
      );

      render(<App />);

      expect(mockLoadAppSettings).not.toHaveBeenCalled();

      resolveMigration();

      await waitFor(() => {
        expect(mockLoadAppSettings).toHaveBeenCalledOnce();
      });
    });
  });

  describe('loadTutorialProgress', () => {
    it('should call loadTutorialProgress after migration completes', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadTutorialProgress).toHaveBeenCalledOnce();
      });
    });

    it('should not call loadTutorialProgress before migration resolves', async () => {
      let resolveMigration!: () => void;
      mockRunV5Migration.mockReturnValue(
        new Promise<void>(resolve => {
          resolveMigration = resolve;
        })
      );

      render(<App />);

      expect(mockLoadTutorialProgress).not.toHaveBeenCalled();

      resolveMigration();

      await waitFor(() => {
        expect(mockLoadTutorialProgress).toHaveBeenCalledOnce();
      });
    });
  });

  // -- Parallel loaders (independent of migration) --

  describe('loadFeatureFlags', () => {
    it('should call loadFeatureFlags on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadFeatureFlags).toHaveBeenCalledOnce();
      });
    });
  });

  // -- Encryption metadata → provider config chain --

  describe('loadEncryptionMetadata and loadProviderConfigs', () => {
    it('should call loadEncryptionMetadata on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadEncryptionMetadata).toHaveBeenCalledOnce();
      });
    });

    it('should call loadProviderConfigs after loadEncryptionMetadata completes', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadProviderConfigs).toHaveBeenCalledOnce();
      });
    });

    it('should not call loadProviderConfigs before loadEncryptionMetadata resolves', async () => {
      let resolveEncryption!: () => void;
      mockLoadEncryptionMetadata.mockReturnValue(
        new Promise<void>(resolve => {
          resolveEncryption = resolve;
        })
      );

      render(<App />);

      expect(mockLoadProviderConfigs).not.toHaveBeenCalled();

      resolveEncryption();

      await waitFor(() => {
        expect(mockLoadProviderConfigs).toHaveBeenCalledOnce();
      });
    });
  });

  // -- Skills chain --

  describe('seedBuiltinSkills and loadSkills', () => {
    it('should call seedBuiltinSkills on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockSeedBuiltinSkills).toHaveBeenCalledOnce();
      });
    });

    it('should call loadSkills after seedBuiltinSkills completes', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadSkills).toHaveBeenCalledOnce();
      });
    });

    it('should call loadContainers on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockLoadContainers).toHaveBeenCalledOnce();
      });
    });
  });

  // -- Full sequence --

  describe('full loader sequence', () => {
    it('should invoke all loaders exactly once on mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockRunV5Migration).toHaveBeenCalledOnce();
        expect(mockLoadAppSettings).toHaveBeenCalledOnce();
        expect(mockLoadTutorialProgress).toHaveBeenCalledOnce();
        expect(mockLoadEncryptionMetadata).toHaveBeenCalledOnce();
        expect(mockLoadProviderConfigs).toHaveBeenCalledOnce();
        expect(mockLoadFeatureFlags).toHaveBeenCalledOnce();
        expect(mockLoadContainers).toHaveBeenCalledOnce();
        expect(mockSeedBuiltinSkills).toHaveBeenCalledOnce();
        expect(mockLoadSkills).toHaveBeenCalledOnce();
      });
    });

    it('should not invoke any loader more than once on a single mount', async () => {
      render(<App />);

      await waitFor(() => {
        expect(mockRunV5Migration).toHaveBeenCalledOnce();
      });

      // Allow all chained promises to settle
      await waitFor(() => {
        expect(mockLoadSkills).toHaveBeenCalledOnce();
      });

      expect(mockRunV5Migration).toHaveBeenCalledOnce();
      expect(mockLoadAppSettings).toHaveBeenCalledOnce();
      expect(mockLoadTutorialProgress).toHaveBeenCalledOnce();
      expect(mockLoadEncryptionMetadata).toHaveBeenCalledOnce();
      expect(mockLoadProviderConfigs).toHaveBeenCalledOnce();
      expect(mockLoadFeatureFlags).toHaveBeenCalledOnce();
      expect(mockLoadContainers).toHaveBeenCalledOnce();
      expect(mockSeedBuiltinSkills).toHaveBeenCalledOnce();
      expect(mockLoadSkills).toHaveBeenCalledOnce();
    });
  });
});
