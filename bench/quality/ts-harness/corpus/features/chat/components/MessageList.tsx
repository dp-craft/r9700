import type * as React from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';

import type { MessageViewModel } from '../types';
import { MessageBubble } from './MessageBubble';

const STREAMING_CREATED_AT = 0;

export interface MessageListLabels {
  readonly copyLabel: string;
  readonly copyAriaLabel: string;
  readonly streamingAriaLabel: string;
  readonly userMessageAria: string;
  readonly assistantMessageAria: string;
  readonly showOriginalLabel?: string;
  readonly showTranslatedLabel?: string;
  readonly sourcesLabel?: string;
  readonly reasoningTitle?: string;
  readonly citationPrefix?: string;
}

export interface MessageListProps {
  readonly messages: readonly MessageViewModel[];
  readonly isStreaming: boolean;
  readonly streamingContent: string;
  readonly bottomRef: React.RefObject<HTMLDivElement | null>;
  readonly onCopyMessage: (content: string) => void;
  readonly fontSizeClass?: string;
  readonly labels?: MessageListLabels;
  readonly showingOriginalMap?: ReadonlyMap<string, boolean>;
  readonly onToggleOriginal?: (messageId: string) => void;
  readonly badgeMap?: ReadonlyMap<string, boolean>;
  readonly showStreamingBadge?: boolean;
  readonly activeModelId?: string;
  readonly streamingReasoning?: string;
  readonly showTestInLab?: boolean;
  readonly onTestInLab?: (message: MessageViewModel) => void;
  readonly testInLabLabel?: string;
}

function makeToggleHandler(
  onToggle: ((messageId: string) => void) | undefined,
  messageId: string
): (() => void) | undefined {
  if (onToggle === undefined) return undefined;
  return () => onToggle(messageId);
}

function makeTestInLabHandler(
  onTestInLab: ((message: MessageViewModel) => void) | undefined,
  message: MessageViewModel
): (() => void) | undefined {
  if (onTestInLab === undefined) return undefined;
  return () => onTestInLab(message);
}

export function MessageList({
  messages,
  isStreaming,
  streamingContent,
  bottomRef,
  onCopyMessage,
  labels,
  showingOriginalMap,
  onToggleOriginal,
  badgeMap,
  showStreamingBadge = false,
  activeModelId,
  streamingReasoning,
  showTestInLab,
  onTestInLab,
  testInLabLabel,
}: MessageListProps): React.ReactElement {
  const streamingMessage: MessageViewModel | null = isStreaming
    ? {
        id: 'streaming',
        sessionId: '',
        role: 'assistant',
        content: streamingContent,
        createdAt: STREAMING_CREATED_AT,
        model: activeModelId,
        reasoning: streamingReasoning,
      }
    : null;

  return (
    <ScrollArea className="min-h-0 flex-1 overflow-x-hidden p-4">
      <div className="mx-auto flex max-w-3xl min-w-0 flex-col gap-4">
        {messages.map(message => (
          <MessageBubble
            key={message.id}
            message={message}
            showModelBadge={badgeMap?.get(message.id) ?? false}
            onCopy={onCopyMessage}
            showingOriginal={showingOriginalMap?.get(message.id) ?? false}
            onToggleOriginal={makeToggleHandler(onToggleOriginal, message.id)}
            showTestInLab={showTestInLab}
            onTestInLab={makeTestInLabHandler(onTestInLab, message)}
            testInLabLabel={testInLabLabel}
            {...labels}
          />
        ))}
        {streamingMessage !== null && (
          <MessageBubble
            message={streamingMessage}
            isStreaming
            showModelBadge={showStreamingBadge}
            onCopy={onCopyMessage}
            {...labels}
          />
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>
    </ScrollArea>
  );
}
