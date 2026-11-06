/** Union of all registered feature flag keys */
export type FeatureFlagKey =
  | 'prompt-lab-enabled'
  | 'show-cors-providers'
  | 'tutorial-enabled'
  | 'web-search-enabled'
  | 'lab-perplexity-enabled'
  | 'lab-text-analysis-enabled';

/** Static definition of a feature flag in the registry */
export interface FeatureFlagDefinition {
  readonly key: FeatureFlagKey;
  readonly defaultValue: boolean;
}

/** Registry mapping all flag keys to their definitions */
export type FeatureFlagRegistry = Readonly<Record<FeatureFlagKey, FeatureFlagDefinition>>;

/** Runtime state of all feature flags (in Zustand store) */
export interface FeatureFlagState {
  readonly flags: Readonly<Record<FeatureFlagKey, boolean>>;
}

/** Actions exposed by the feature flag store */
export interface FeatureFlagActions {
  /** Load flag values from IDB, merging with registry defaults */
  readonly loadFeatureFlags: () => Promise<void>;

  /** Toggle a flag and persist to IDB */
  readonly toggleFlag: (key: FeatureFlagKey) => Promise<void>;

  /** Get current value of a specific flag */
  readonly getFlag: (key: FeatureFlagKey) => boolean;
}

/** Complete Zustand store type */
export type FeatureFlagStore = FeatureFlagState & FeatureFlagActions;
