import * as React from 'react';

import { ReasoningPanel } from '@/components/reasoning-panel/ReasoningPanel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { MessageViewModel } from '../types';
import { CitationSources } from './CitationSources';
import { MessageRenderer } from './MessageRenderer';

type Citation = NonNullable<MessageViewModel['citations']>[number];

const CITATION_MARKER_PATTERN = /\[(\d+)\]/g;

function hasCitations(message: MessageViewModel): boolean {
  return (
    message.role === 'assistant' && message.citations !== undefined && message.citations.length > 0
  );
}

function buildCitationLookup(citations: readonly Citation[]): ReadonlyMap<number, Citation> {
  return new Map(citations.map(c => [c.index, c]));
}

function renderCitationMarker(citation: Citation, citationPrefix: string): React.ReactElement {
  return (
    <sup key={`cite-${citation.index}`}>
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 text-xs no-underline"
        aria-label={`${citationPrefix} ${citation.index}: ${citation.title}`}
      >
        [{citation.index}]
      </a>
    </sup>
  );
}

function renderContentWithCitations(
  content: string,
  citations: readonly Citation[],
  citationPrefix: string
): React.ReactNode {
  const lookup = buildCitationLookup(citations);
  const parts = content.split(CITATION_MARKER_PATTERN);

  return parts.map((part, i) => {
    if (i % 2 === 0) {
      return (
        <span key={`text-${String(i)}`} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    }
    const index = Number(part);
    const citation = lookup.get(index);
    if (!citation) return `[${part}]`;
    return renderCitationMarker(citation, citationPrefix);
  });
}

export interface MessageBubbleProps {
  readonly message: MessageViewModel;
  readonly isStreaming?: boolean;
  readonly onCopy: (content: string) => void;
  readonly showModelBadge?: boolean;
  readonly copyLabel?: string;
  readonly copyAriaLabel?: string;
  readonly streamingAriaLabel?: string;
  readonly userMessageAria?: string;
  readonly assistantMessageAria?: string;
  readonly showOriginalLabel?: string;
  readonly showTranslatedLabel?: string;
  readonly showingOriginal?: boolean;
  readonly onToggleOriginal?: () => void;
  readonly sourcesLabel?: string;
  readonly showTestInLab?: boolean;
  readonly onTestInLab?: () => void;
  readonly testInLabLabel?: string;
  readonly reasoningTitle?: string;
  readonly citationPrefix?: string;
}

const DEFAULT_COPY_LABEL = 'Copy';
const DEFAULT_COPY_ARIA = 'Copy message to clipboard';
const DEFAULT_STREAMING_ARIA = 'Streaming';
const DEFAULT_USER_MESSAGE_ARIA = 'Your message';
const DEFAULT_ASSISTANT_MESSAGE_ARIA = 'Assistant message';
const DEFAULT_SHOW_ORIGINAL_LABEL = 'Show original';
const DEFAULT_SHOW_TRANSLATED_LABEL = 'Show translated';
const DEFAULT_SOURCES_LABEL = 'Sources';
const DEFAULT_TEST_IN_LAB_LABEL = 'Test in Lab';
const DEFAULT_REASONING_TITLE = 'Thinking';
const DEFAULT_CITATION_PREFIX = 'Citation';

const ACTION_CLUSTER_CLASSES: string = cn(
  'absolute top-full right-0 z-10 mt-1 flex gap-0.5',
  'opacity-0 transition-opacity duration-500 delay-[750ms] group-hover:opacity-100 focus-within:opacity-100'
);

function getMessageAria(isUser: boolean, userAria: string, assistantAria: string): string {
  return isUser ? userAria : assistantAria;
}

const handleCopy =
  (onCopy: (content: string) => void, content: string): (() => void) =>
    (): void =>
      onCopy(content);

function extractAlternateText(message: MessageViewModel): string | null {
  if (!message.pipelineTrace) return null;
  const steps = message.pipelineTrace.steps;
  if (message.role === 'assistant') {
    const step = steps.find(s => s.stepId === 'main-llm');
    return step?.output ?? null;
  }
  const step = steps.find(s => s.stepId === 'translate-input');
  return step?.output ?? null;
}

function getToggleLabel(
  isUser: boolean,
  showingOriginal: boolean,
  showOriginalLabel: string,
  showTranslatedLabel: string
): string {
  if (isUser) return showingOriginal ? showOriginalLabel : showTranslatedLabel;
  return showingOriginal ? showTranslatedLabel : showOriginalLabel;
}

function getDisplayContent(
  message: MessageViewModel,
  alternateText: string | null,
  showingOriginal: boolean
): string {
  if (showingOriginal && alternateText !== null) return alternateText;
  return message.content;
}

function MessageBubbleInner({
  message,
  isStreaming = false,
  onCopy,
  showModelBadge = false,
  copyLabel = DEFAULT_COPY_LABEL,
  copyAriaLabel = DEFAULT_COPY_ARIA,
  streamingAriaLabel = DEFAULT_STREAMING_ARIA,
  userMessageAria = DEFAULT_USER_MESSAGE_ARIA,
  assistantMessageAria = DEFAULT_ASSISTANT_MESSAGE_ARIA,
  showOriginalLabel = DEFAULT_SHOW_ORIGINAL_LABEL,
  showTranslatedLabel = DEFAULT_SHOW_TRANSLATED_LABEL,
  showingOriginal = false,
  onToggleOriginal,
  sourcesLabel = DEFAULT_SOURCES_LABEL,
  showTestInLab = false,
  onTestInLab,
  testInLabLabel = DEFAULT_TEST_IN_LAB_LABEL,
  reasoningTitle = DEFAULT_REASONING_TITLE,
  citationPrefix = DEFAULT_CITATION_PREFIX,
}: MessageBubbleProps): React.ReactElement {
  const isUser = message.role === 'user';
  const articleAria = getMessageAria(isUser, userMessageAria, assistantMessageAria);
  const alternateText = extractAlternateText(message);
  const displayContent = getDisplayContent(message, alternateText, showingOriginal);
  const toggleLabel = getToggleLabel(
    isUser,
    showingOriginal,
    showOriginalLabel,
    showTranslatedLabel
  );

  return (
    <article
      className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}
      aria-label={articleAria}
    >
      <div
        className={cn(
          'group relative flex max-w-prose flex-col gap-1',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {showModelBadge && (
          <span data-testid="model-badge" className="text-muted-foreground text-xs">
            {message.model}
          </span>
        )}

        <div className="bg-muted text-foreground relative rounded-[14px] px-3.5 py-2.5">
          <ReasoningPanel reasoning={message.reasoning ?? ''} title={reasoningTitle} />
          {hasCitations(message) ? (
            <div className="text-sm leading-relaxed">
              {renderContentWithCitations(displayContent, message.citations ?? [], citationPrefix)}
            </div>
          ) : (
            <MessageRenderer content={displayContent} />
          )}
          {isStreaming && (
            <output
              className="ml-1 inline-block animate-pulse"
              aria-label={streamingAriaLabel}
              aria-live="polite"
            >
              ▋
            </output>
          )}

          <div className={ACTION_CLUSTER_CLASSES}>
            {showTestInLab && onTestInLab !== undefined && (
              <Button
                variant="default"
                size="xs"
                onClick={onTestInLab}
                aria-label={testInLabLabel}
                data-testid="test-in-lab-button"
              >
                ⚗ {testInLabLabel}
              </Button>
            )}
            <Button
              variant="default"
              size="xs"
              onClick={handleCopy(onCopy, message.content)}
              aria-label={copyAriaLabel}
            >
              {copyLabel}
            </Button>
          </div>
        </div>

        {hasCitations(message) && (
          <CitationSources citations={message.citations ?? []} sourcesLabel={sourcesLabel} />
        )}

        {alternateText !== null && onToggleOriginal !== undefined && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onToggleOriginal}
            className="text-muted-foreground mt-1 text-xs"
          >
            {toggleLabel}
          </Button>
        )}
      </div>
    </article>
  );
}

export const MessageBubble: React.MemoExoticComponent<
  (props: MessageBubbleProps) => React.ReactElement
> = React.memo(MessageBubbleInner);
