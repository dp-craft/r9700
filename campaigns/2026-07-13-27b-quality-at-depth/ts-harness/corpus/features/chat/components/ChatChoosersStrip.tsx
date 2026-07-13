import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ChatChoosersStripProps {
  readonly modelChooserSlot: ReactNode;
  readonly systemPromptChooserSlot: ReactNode;
  readonly className?: string;
}

export const ChatChoosersStrip = ({
  modelChooserSlot,
  systemPromptChooserSlot,
  className,
}: ChatChoosersStripProps): ReactElement => {
  return (
    <header
      className={cn(
        'flex w-full items-center gap-3 border-b border-line bg-bg px-4 py-3',
        className
      )}
    >
      <section className="min-w-0 flex-1" data-model-row>
        {modelChooserSlot}
      </section>
      <section className="min-w-0 flex-1" data-skill-row>
        {systemPromptChooserSlot}
      </section>
    </header>
  );
};
