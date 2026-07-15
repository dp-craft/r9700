import { Brain } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

export interface ModelBadgesProps {
  readonly contextLength?: string | null;
  readonly pricing?: string | null;
  readonly modalities?: readonly string[];
  readonly supportsThinking?: boolean;
  readonly thinkingEnabled?: boolean;
}

const BADGE_CLASS =
  'text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px] leading-tight';
const THINKING_ICON_CLASS = 'h-2.5 w-2.5';

function hasContent(props: ModelBadgesProps): boolean {
  return (
    !!props.contextLength ||
    !!props.pricing ||
    (props.modalities !== undefined && props.modalities.length > 0) ||
    !!props.supportsThinking
  );
}

function renderModality(modality: string): React.ReactElement {
  return (
    <span key={modality} className={BADGE_CLASS}>
      {modality}
    </span>
  );
}

export function ModelBadges({
  contextLength,
  pricing,
  modalities,
  supportsThinking,
  thinkingEnabled,
}: ModelBadgesProps): React.ReactElement | null {
  if (!hasContent({ contextLength, pricing, modalities, supportsThinking })) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {contextLength ? <span className={BADGE_CLASS}>{contextLength} ctx</span> : null}
      {pricing ? <span className={BADGE_CLASS}>{pricing}</span> : null}
      {modalities?.map(renderModality)}
      {supportsThinking ? (
        <span
          data-testid="brain-badge"
          className={cn(BADGE_CLASS, thinkingEnabled && 'text-primary')}
        >
          <span className="inline-flex items-center gap-0.5">
            <Brain className={THINKING_ICON_CLASS} aria-hidden="true" />
            thinking
          </span>
        </span>
      ) : null}
    </div>
  );
}
