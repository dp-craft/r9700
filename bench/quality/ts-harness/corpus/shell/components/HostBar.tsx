import { memo, type ReactElement, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface HostBarProps {
  readonly logoSlot: ReactNode;
  readonly pillsSlot: ReactNode;
  readonly fontSizeSlot?: ReactNode;
  readonly themeSwitchSlot: ReactNode;
  readonly indicatorSlot?: ReactNode;
  readonly settingsSlot: ReactNode;
  readonly accentColor: 'blue' | 'purple';
}

const ACCENT_STRIPE_CLASS: Record<HostBarProps['accentColor'], string> = {
  blue: 'bg-mf-chat',
  purple: 'bg-mf-lab',
};

const HostBarComponent = ({
  logoSlot,
  pillsSlot,
  indicatorSlot,
  fontSizeSlot,
  themeSwitchSlot,
  settingsSlot,
  accentColor,
}: HostBarProps): ReactElement => {
  const stripeClass = ACCENT_STRIPE_CLASS[accentColor];

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="flex h-14 w-full items-center gap-4 border-b border-border bg-background px-4">
        <div className="flex flex-none items-center">{logoSlot}</div>
        <div className="flex flex-1 items-center justify-center">{pillsSlot}</div>
        {indicatorSlot}
        <div className="flex flex-none items-center gap-2">
          {fontSizeSlot}
          {themeSwitchSlot}
          {settingsSlot}
        </div>
      </div>
      <div className={cn('h-px w-full', stripeClass)} aria-hidden="true" />
    </header>
  );
};

export const HostBar: React.MemoExoticComponent<(props: HostBarProps) => ReactElement> =
  memo(HostBarComponent);
