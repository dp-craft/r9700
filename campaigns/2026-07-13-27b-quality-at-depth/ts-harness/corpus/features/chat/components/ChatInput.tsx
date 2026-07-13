import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface ChatInputProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onAbort: () => void;
  readonly isStreaming: boolean;
  readonly canSend: boolean;
  readonly className?: string;
  readonly textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  readonly placeholder?: string;
  readonly inputAriaLabel?: string;
  readonly sendAriaLabel?: string;
  readonly sendLabel?: string;
  readonly stopAriaLabel?: string;
  readonly stopLabel?: string;
  readonly onTestInLabClick?: () => void;
  readonly testInLabAriaLabel?: string;
  readonly onArrowUp?: (textarea: HTMLTextAreaElement) => boolean;
  readonly onArrowDown?: (textarea: HTMLTextAreaElement) => boolean;
  readonly onEscape?: () => void;
}

const DEFAULT_PLACEHOLDER = 'Type a message… (Enter to send, Shift+Enter for newline)';
const DEFAULT_INPUT_ARIA = 'Message input';
const DEFAULT_SEND_ARIA = 'Send message';
const DEFAULT_SEND_LABEL = 'Send';
const DEFAULT_STOP_ARIA = 'Stop generation';
const DEFAULT_STOP_LABEL = 'Stop';
const DEFAULT_TEST_IN_LAB_ARIA = 'Test in Lab';
const TEST_IN_LAB_ICON = '🧪';

export function ChatInput({
  value,
  onValueChange,
  onSubmit,
  onAbort,
  isStreaming,
  canSend,
  className,
  textareaRef,
  placeholder = DEFAULT_PLACEHOLDER,
  inputAriaLabel = DEFAULT_INPUT_ARIA,
  sendAriaLabel = DEFAULT_SEND_ARIA,
  sendLabel = DEFAULT_SEND_LABEL,
  stopAriaLabel = DEFAULT_STOP_ARIA,
  stopLabel = DEFAULT_STOP_LABEL,
  onTestInLabClick,
  testInLabAriaLabel = DEFAULT_TEST_IN_LAB_ARIA,
  onArrowUp,
  onArrowDown,
  onEscape,
}: ChatInputProps): React.ReactElement {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === 'ArrowUp' && onArrowUp && textareaRef?.current) {
      const handled = onArrowUp(textareaRef.current);
      if (handled) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown' && onArrowDown && textareaRef?.current) {
      const handled = onArrowDown(textareaRef.current);
      if (handled) {
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    onValueChange(e.target.value);
  };

  const isDraftEmpty = value.trim().length === 0;

  return (
    <div
      className={cn(
        'border-border bg-background flex shrink-0 items-end gap-2 rounded-lg border p-2',
        className
      )}
      data-testid="chat-input"
    >
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={isStreaming}
        rows={3}
        className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        aria-label={inputAriaLabel}
        aria-disabled={isStreaming}
      />
      {onTestInLabClick && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onTestInLabClick}
          disabled={isDraftEmpty}
          aria-label={testInLabAriaLabel}
          data-testid="chat-input-test-in-lab"
        >
          <span aria-hidden="true">{TEST_IN_LAB_ICON}</span>
        </Button>
      )}
      {isStreaming ? (
        <Button
          variant="outline"
          onClick={onAbort}
          aria-label={stopAriaLabel}
          data-testid="chat-input-stop"
        >
          {stopLabel}
        </Button>
      ) : (
        <Button
          onClick={onSubmit}
          disabled={!canSend}
          aria-label={sendAriaLabel}
          data-testid="chat-input-send"
        >
          {sendLabel}
        </Button>
      )}
    </div>
  );
}
