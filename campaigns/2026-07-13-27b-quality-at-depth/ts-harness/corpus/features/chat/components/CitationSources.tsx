import type * as React from 'react';

import { cn } from '@/lib/utils';

interface CitationItem {
  readonly index: number;
  readonly title: string;
  readonly url: string;
}

export interface CitationSourcesProps {
  readonly citations: readonly CitationItem[];
  readonly className?: string;
  readonly sourcesLabel?: string;
}

const DEFAULT_SOURCES_LABEL = 'Sources';

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatCitationText(index: number, title: string, domain: string): string {
  if (title.length === 0) return `[${index}] ${domain}`;
  return `[${index}] ${title} — ${domain}`;
}

function renderCitationItem(citation: CitationItem): React.ReactElement {
  const domain = extractDomain(citation.url);
  const text = formatCitationText(citation.index, citation.title, domain);

  return (
    <li key={citation.index}>
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground block text-xs underline-offset-2 hover:underline"
        aria-label={`Source ${citation.index}: ${citation.title || domain}`}
      >
        {text}
      </a>
    </li>
  );
}

export function CitationSources({
  citations,
  className,
  sourcesLabel = DEFAULT_SOURCES_LABEL,
}: CitationSourcesProps): React.ReactElement | null {
  if (citations.length === 0) return null;

  return (
    <details className={cn('border-border mt-2 border-t pt-2', className)}>
      <summary
        className="text-muted-foreground cursor-pointer list-none text-xs font-medium"
        aria-label={`${sourcesLabel} (${citations.length})`}
      >
        {sourcesLabel} ({citations.length})
      </summary>
      <ol className="mt-1 list-none space-y-0.5 pl-0" aria-label={sourcesLabel}>
        {citations.map(renderCitationItem)}
      </ol>
    </details>
  );
}
