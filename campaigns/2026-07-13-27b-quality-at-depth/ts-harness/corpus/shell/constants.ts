import { FlaskConical, MessageSquare } from 'lucide-react';

import type { Workspace } from '@/stores/useUIStore';

import type { MFMeta } from './types';

export const MF_REGISTRY: Readonly<Record<Workspace, MFMeta>> = {
  chat: {
    id: 'chat',
    labelKey: 'shell.mf.label.chat',
    accentColor: 'blue',
    icon: MessageSquare,
  },
  'prompt-lab': {
    id: 'prompt-lab',
    labelKey: 'shell.mf.label.prompt-lab',
    accentColor: 'purple',
    icon: FlaskConical,
  },
};
