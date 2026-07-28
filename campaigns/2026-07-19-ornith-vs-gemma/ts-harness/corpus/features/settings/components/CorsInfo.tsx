import type * as React from 'react';

import { cn } from '@/lib/utils';
import {
  CORS_EXTENSION_NAME,
  CORS_EXTENSION_URL,
  CORS_SETUP_STEPS,
  CORS_WARNING
} from '@/services/llm/cors-info';

export interface CorsInfoProps {
  readonly className?: string;
  readonly setupLabel?: string;
  readonly warningAria?: string;
  readonly stepsAria?: string;
  readonly installLinkAria?: string;
}

const renderStep = (step: string, index: number): React.ReactElement => (
  <li key={index} className="text-muted-foreground text-sm">
    {step}
  </li>
);

export function CorsInfo({
  className,
  setupLabel = 'Browser extension setup:',
  warningAria = 'CORS configuration warning',
  stepsAria = 'CORS extension setup steps',
  installLinkAria,
}: CorsInfoProps): React.ReactElement {
  const steps = CORS_SETUP_STEPS.map(renderStep);
  const linkAria = installLinkAria ?? `Install ${CORS_EXTENSION_NAME} (opens in new tab)`;

  return (
    <section
      role="alert"
      aria-label={warningAria}
      className={cn(
        'border-destructive/50 bg-destructive/10 space-y-2 rounded-md border p-3',
        className
      )}
    >
      <p className="text-destructive-foreground text-sm leading-snug font-medium">{CORS_WARNING}</p>

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs font-medium">{setupLabel}</p>
        <ol className="list-inside list-decimal space-y-0.5" aria-label={stepsAria}>
          {steps}
        </ol>
      </div>

      <a
        href={CORS_EXTENSION_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 focus-visible:ring-ring focus-visible:ring-offset-background inline-block rounded-sm text-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label={linkAria}
      >
        {CORS_EXTENSION_NAME}
      </a>
    </section>
  );
}
