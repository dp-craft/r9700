import type * as React from 'react';

import { cn } from '@/lib/utils';

const LOGO_SIZE = 'h-8 w-8';
const APP_NAME = 'AiChatney';
const LOGO_EMOJI = '\u{1F916}';

export interface BrandingHeaderProps {
  readonly onNavigate?: () => void;
  readonly className?: string;
}

function handleClick(onNavigate?: () => void): (e: React.MouseEvent<HTMLAnchorElement>) => void {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate) {
      e.preventDefault();
      onNavigate();
    }
  };
}

export function BrandingHeader({ onNavigate, className }: BrandingHeaderProps): React.ReactElement {
  return (
    <a
      href="/"
      onClick={handleClick(onNavigate)}
      className={cn(
        'flex items-center gap-2 px-3 py-3 no-underline transition-colors',
        'text-foreground hover:text-foreground/80',
        'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:rounded-sm',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          LOGO_SIZE,
          'flex shrink-0 items-center justify-center text-[20px] leading-none'
        )}
      >
        {LOGO_EMOJI}
      </span>
      <span className="text-[18px] font-semibold tracking-tight">{APP_NAME}</span>
    </a>
  );
}
