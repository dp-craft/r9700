import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CitationDTO } from '@/domain/entities';

import type { MessageViewModel } from '../../types';
import type { MessageBubbleProps } from '../MessageBubble';
import { MessageBubble } from '../MessageBubble';

// -- Builders --

const buildCitation = (overrides?: Partial<CitationDTO>): CitationDTO => ({
  index: 1,
  title: 'Test Source',
  url: 'https://example.com',
  ...overrides,
});

const buildMessage = (overrides?: Partial<MessageViewModel>): MessageViewModel => ({
  id: 'msg-1',
  sessionId: 'sess-1',
  role: 'assistant',
  content: 'AI is cool [1] and useful [2]',
  createdAt: 1000000,
  ...overrides,
});

const buildProps = (overrides?: Partial<MessageBubbleProps>): MessageBubbleProps => ({
  message: buildMessage(),
  onCopy: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageBubble citation markers', () => {
  // -- Positive paths --

  it('should render [N] markers as superscript links', () => {
    // Arrange
    const citations: readonly CitationDTO[] = [
      buildCitation({ index: 1, url: 'https://wiki.com' }),
    ];
    const message = buildMessage({ content: 'AI is cool [1]', citations });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert
    const sup = document.querySelector('sup');
    expect(sup).toBeInTheDocument();
    const link = sup?.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('1');
  });

  it('should link citation marker to correct URL with target _blank and rel noopener', () => {
    // Arrange
    const citations: readonly CitationDTO[] = [
      buildCitation({ index: 1, title: 'Wiki', url: 'https://wiki.com' }),
    ];
    const message = buildMessage({ content: 'See here [1]', citations });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert
    const link = document.querySelector('sup a') as HTMLAnchorElement | null;
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://wiki.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('should render multiple citation markers as superscript links', () => {
    // Arrange
    const citations: readonly CitationDTO[] = [
      buildCitation({ index: 1, title: 'Wiki', url: 'https://wiki.com' }),
      buildCitation({ index: 2, title: 'Ref', url: 'https://ref.com' }),
    ];
    const message = buildMessage({ content: 'AI is cool [1] and useful [2]', citations });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert
    const sups = document.querySelectorAll('sup');
    expect(sups).toHaveLength(2);

    const links = document.querySelectorAll('sup a') as NodeListOf<HTMLAnchorElement>;
    expect(links[0]).toHaveTextContent('1');
    expect(links[0]).toHaveAttribute('href', 'https://wiki.com');
    expect(links[1]).toHaveTextContent('2');
    expect(links[1]).toHaveAttribute('href', 'https://ref.com');
  });

  // -- Negative cases --

  it('should not render citation markers when citations is undefined', () => {
    // Arrange
    const message = buildMessage({ content: 'See here [1]', citations: undefined });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert
    expect(document.querySelector('sup')).not.toBeInTheDocument();
    expect(screen.getByText(/\[1\]/)).toBeInTheDocument();
  });

  it('should not render citation markers when citations is empty', () => {
    // Arrange
    const message = buildMessage({ content: 'See here [1]', citations: [] });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert
    expect(document.querySelector('sup')).not.toBeInTheDocument();
    expect(screen.getByText(/\[1\]/)).toBeInTheDocument();
  });

  it('should handle malformed citation reference with no matching index as plain text', () => {
    // Arrange — content has [3] but citations only contain index 1 and 2
    const citations: readonly CitationDTO[] = [
      buildCitation({ index: 1, url: 'https://a.com' }),
      buildCitation({ index: 2, url: 'https://b.com' }),
    ];
    const message = buildMessage({ content: 'Unclear [3] reference', citations });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert — [3] stays as plain text, no link for it
    const links = document.querySelectorAll('sup a') as NodeListOf<HTMLAnchorElement>;
    const linkTexts = Array.from(links).map(l => l.textContent);
    expect(linkTexts).not.toContain('3');
    expect(screen.getByText(/\[3\]/)).toBeInTheDocument();
  });

  it('should not render citation markers for user messages even when citations is provided', () => {
    // Arrange
    const citations: readonly CitationDTO[] = [
      buildCitation({ index: 1, url: 'https://wiki.com' }),
    ];
    const message = buildMessage({ role: 'user', content: 'Check [1] this', citations });

    // Act
    render(<MessageBubble {...buildProps({ message })} />);

    // Assert — user messages never show citation superscripts
    expect(document.querySelector('sup')).not.toBeInTheDocument();
  });
});
