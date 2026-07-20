/**
 * Tests for the citations field on MessageViewModel (T012).
 *
 * These tests verify that citations data can flow from ChatMessage through
 * MessageViewModel to the chat renderer layer. Tests are written against
 * observable behavior: that MessageBubble renders citation links when
 * citations are present on the view model.
 *
 * Tests are RED until:
 *  1. `citations` is added to MessageViewModel (T012 — this task)
 *  2. MessageBubble receives and renders citation links (subsequent task)
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CitationDTO } from '@/domain/entities';

import type { MessageBubbleProps } from './components/MessageBubble';
import { MessageBubble } from './components/MessageBubble';
import type { MessageViewModel } from './types';

// -- Builders --

const buildCitation = (overrides?: Partial<CitationDTO>): CitationDTO => ({
  index: 1,
  title: 'Example Source',
  url: 'https://example.com',
  ...overrides,
});

const buildMessage = (overrides?: Partial<MessageViewModel>): MessageViewModel =>
  ({
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    content: 'Answer with citations.',
    createdAt: 1_700_000_000_000,
    // Spread via unknown to allow assignment until citations is on MessageViewModel.
    // Remove this cast once citations?: readonly CitationDTO[] is on MessageViewModel.
    ...(overrides as Record<string, unknown>),
  }) as MessageViewModel;

const buildProps = (overrides?: Partial<MessageBubbleProps>): MessageBubbleProps => ({
  message: buildMessage(),
  onCopy: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessageViewModel — citations field', () => {
  describe('when MessageBubble receives a message with citations', () => {
    it('should render a citations section', () => {
      // Arrange
      const citation = buildCitation({ index: 1, title: 'Test Source', url: 'https://test.com' });
      const message = buildMessage({ citations: [citation] as readonly CitationDTO[] });

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert — citations section summary must be present
      expect(screen.getByText(/sources/i)).toBeTruthy();
    });

    it('should render a link for each citation', () => {
      // Arrange
      const citations: readonly CitationDTO[] = [
        buildCitation({ index: 1, title: 'First Source', url: 'https://first.example.com' }),
        buildCitation({ index: 2, title: 'Second Source', url: 'https://second.example.com' }),
      ];
      const message = buildMessage({ citations });

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert — citation source links in the sources section (plus inline superscript links)
      const sourceLinks = document.querySelectorAll('details a');
      expect(sourceLinks).toHaveLength(2);
    });

    it('should render citation link with correct href and label', () => {
      // Arrange
      const citation = buildCitation({
        index: 1,
        title: 'Wikipedia: AI',
        url: 'https://en.wikipedia.org/wiki/AI',
      });
      const message = buildMessage({ citations: [citation] as readonly CitationDTO[] });

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert — citation source link in details section
      const sourceLink = document.querySelector(
        'details a[href="https://en.wikipedia.org/wiki/AI"]'
      );
      expect(sourceLink).toBeInTheDocument();
    });

    it('should render citations in index order', () => {
      // Arrange
      const citations: readonly CitationDTO[] = [
        buildCitation({ index: 1, title: 'Alpha', url: 'https://alpha.com' }),
        buildCitation({ index: 2, title: 'Beta', url: 'https://beta.com' }),
        buildCitation({ index: 3, title: 'Gamma', url: 'https://gamma.com' }),
      ];
      const message = buildMessage({ citations });

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert — source links appear in document order matching citation index
      const sourceLinks = document.querySelectorAll('details a');
      expect(sourceLinks).toHaveLength(3);
      expect(sourceLinks[0]).toHaveAttribute('href', 'https://alpha.com');
      expect(sourceLinks[1]).toHaveAttribute('href', 'https://beta.com');
      expect(sourceLinks[2]).toHaveAttribute('href', 'https://gamma.com');
    });
  });

  describe('when MessageBubble receives a message without citations', () => {
    it('should not render a citations section', () => {
      // Arrange
      const message = buildMessage(); // no citations

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert — no citations heading when field is absent
      expect(document.querySelector('details')).not.toBeInTheDocument();
    });

    it('should not render any citation links', () => {
      // Arrange
      const message = buildMessage();

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  describe('when MessageBubble receives a message with an empty citations array', () => {
    it('should not render a citations section', () => {
      // Arrange
      const message = buildMessage({ citations: [] as readonly CitationDTO[] });

      // Act
      render(<MessageBubble {...buildProps({ message })} />);

      // Assert
      expect(document.querySelector('details')).not.toBeInTheDocument();
    });
  });
});
