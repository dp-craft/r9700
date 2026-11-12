export type {
  FeatureFlagActions,
  FeatureFlagDefinition,
  FeatureFlagKey,
  FeatureFlagRegistry,
  FeatureFlagState,
  FeatureFlagStore
} from './types';

import type { FeatureFlagRegistry } from './types';

export const FEATURE_FLAG_REGISTRY: FeatureFlagRegistry = {
  'prompt-lab-enabled': {
    key: 'prompt-lab-enabled',
    defaultValue: true,
  },
  'show-cors-providers': {
    key: 'show-cors-providers',
    defaultValue: false,
  },
  'tutorial-enabled': {
    key: 'tutorial-enabled',
    defaultValue: false, // FR-082: tutorial disabled by default; module preserved for future re-enable
  },
  'web-search-enabled': {
    key: 'web-search-enabled',
    defaultValue: false,
  },
  'lab-perplexity-enabled': {
    key: 'lab-perplexity-enabled',
    defaultValue: false,
  },
  'lab-text-analysis-enabled': {
    key: 'lab-text-analysis-enabled',
    defaultValue: false,
  },
} as const;
