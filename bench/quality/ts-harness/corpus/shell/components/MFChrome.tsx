import { memo, type ReactElement } from 'react';

import { Pill } from '@/components/ui/Pill';
import { cn } from '@/lib/utils';

export interface MFChromeProps {
  readonly labelText: string;
  readonly accentColor: 'blue' | 'purple';
  readonly className?: string;
}

const getAccentClasses = (accentColor: MFChromeProps['accentColor']): string => {
  if (accentColor === 'blue') {
    return 'border-mf-chat/30 text-mf-chat bg-mf-chat/5';
  }
  return 'border-mf-lab/30 text-mf-lab bg-mf-lab/5';
};

export const MFChrome: React.MemoExoticComponent<(props: MFChromeProps) => ReactElement> = memo(
  ({ labelText, accentColor, className }: MFChromeProps): ReactElement => (
    <Pill className={cn(getAccentClasses(accentColor), className)}>{labelText}</Pill>
  )
);

MFChrome.displayName = 'MFChrome';
