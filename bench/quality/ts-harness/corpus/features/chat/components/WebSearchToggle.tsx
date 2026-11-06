import { Globe } from 'lucide-react';
import type React from 'react';

import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface WebSearchToggleProps {
  readonly enabled: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly visible: boolean;
  readonly tooltipText?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
}

const globeClassName = (enabled: boolean): string =>
  cn('h-4 w-4', enabled ? 'text-primary' : 'text-muted-foreground');

function renderGlobeIcon(enabled: boolean, tooltipText: string | undefined): React.ReactElement {
  const globe = <Globe className={globeClassName(enabled)} aria-hidden="true" />;

  if (!enabled || !tooltipText) return globe;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{globe}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WebSearchToggle({
  enabled,
  onToggle,
  visible,
  tooltipText,
  ariaLabel = 'Toggle web search',
  className,
}: WebSearchToggleProps): React.ReactElement | null {
  if (!visible) return null;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {renderGlobeIcon(enabled, tooltipText)}
      <Switch checked={enabled} onCheckedChange={onToggle} aria-label={ariaLabel} />
    </div>
  );
}
