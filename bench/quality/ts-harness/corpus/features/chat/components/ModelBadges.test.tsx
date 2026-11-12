import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ModelBadgesProps } from './ModelBadges';
import { ModelBadges } from './ModelBadges';

// -- Builders --

const buildProps = (overrides?: Partial<ModelBadgesProps>): ModelBadgesProps => ({
  contextLength: null,
  pricing: null,
  modalities: [],
  supportsThinking: false,
  ...overrides,
});

// -- Helpers --

const getBrainBadge = (): HTMLElement => screen.getByTestId('brain-badge');

// -- Setup --

beforeEach(() => {
  // no shared mutable state to reset
});

// -- Tests --

describe('ModelBadges', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(
      <ModelBadges contextLength="32K" pricing={null} modalities={[]} />
    );

    expect(container).toBeTruthy();
  });

  it('should return null when no props have content', () => {
    const { container } = render(<ModelBadges {...buildProps()} />);

    expect(container.firstChild).toBeNull();
  });

  // -- contextLength badge --

  describe('contextLength badge', () => {
    it('should render context badge when contextLength is provided', () => {
      render(<ModelBadges {...buildProps({ contextLength: '128K' })} />);

      expect(screen.getByText('128K ctx')).toBeInTheDocument();
    });

    it('should not render context badge when contextLength is null', () => {
      render(<ModelBadges {...buildProps({ contextLength: null, pricing: '$1' })} />);

      expect(screen.queryByText(/ctx/)).not.toBeInTheDocument();
    });
  });

  // -- pricing badge --

  describe('pricing badge', () => {
    it('should render pricing badge when pricing is provided', () => {
      render(<ModelBadges {...buildProps({ pricing: '$0.001 in / $0.002 out per 1M' })} />);

      expect(screen.getByText('$0.001 in / $0.002 out per 1M')).toBeInTheDocument();
    });

    it('should not render pricing badge when pricing is null', () => {
      render(<ModelBadges {...buildProps({ pricing: null, contextLength: '32K' })} />);

      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });
  });

  // -- modalities badges --

  describe('modalities badges', () => {
    it('should render a badge for each modality provided', () => {
      render(<ModelBadges {...buildProps({ modalities: ['image', 'video'] })} />);

      expect(screen.getByText('image')).toBeInTheDocument();
      expect(screen.getByText('video')).toBeInTheDocument();
    });

    it('should not render any modality badge when modalities is empty', () => {
      render(<ModelBadges {...buildProps({ pricing: '$1', modalities: [] })} />);

      expect(screen.queryByText('image')).not.toBeInTheDocument();
    });
  });

  // -- supportsThinking / thinkingEnabled --

  describe('brain badge (thinking)', () => {
    it('should render thinking badge when supportsThinking is true', () => {
      render(<ModelBadges {...buildProps({ supportsThinking: true })} />);

      expect(screen.getByText('thinking')).toBeInTheDocument();
    });

    it('should not render thinking badge when supportsThinking is false', () => {
      render(<ModelBadges {...buildProps({ supportsThinking: false, contextLength: '32K' })} />);

      expect(screen.queryByText('thinking')).not.toBeInTheDocument();
    });

    it('should not render thinking badge when supportsThinking is undefined', () => {
      render(
        <ModelBadges {...buildProps({ supportsThinking: undefined, contextLength: '32K' })} />
      );

      expect(screen.queryByText('thinking')).not.toBeInTheDocument();
    });

    // -- thinkingEnabled prop (RED: prop not yet implemented) --

    it('should render brain badge in muted state when thinkingEnabled is false', () => {
      render(<ModelBadges {...buildProps({ supportsThinking: true, thinkingEnabled: false })} />);

      const brainBadge = getBrainBadge();

      expect(brainBadge).toHaveClass('text-muted-foreground');
      expect(brainBadge).not.toHaveClass('text-primary');
    });

    it('should render brain badge in muted state when thinkingEnabled is undefined', () => {
      render(
        <ModelBadges {...buildProps({ supportsThinking: true, thinkingEnabled: undefined })} />
      );

      const brainBadge = getBrainBadge();

      expect(brainBadge).toHaveClass('text-muted-foreground');
      expect(brainBadge).not.toHaveClass('text-primary');
    });

    it('should render brain badge in accented state when thinkingEnabled is true', () => {
      render(<ModelBadges {...buildProps({ supportsThinking: true, thinkingEnabled: true })} />);

      const brainBadge = getBrainBadge();

      expect(brainBadge).toHaveClass('text-primary');
      expect(brainBadge).not.toHaveClass('text-muted-foreground');
    });
  });

  // -- Edge cases --

  describe('edge cases', () => {
    it('should render nothing with empty modalities, no pricing, no contextLength, and supportsThinking false', () => {
      const { container } = render(
        <ModelBadges modalities={[]} pricing={null} contextLength={null} supportsThinking={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render only the thinking badge when all other props are empty but supportsThinking is true', () => {
      render(
        <ModelBadges modalities={[]} pricing={null} contextLength={null} supportsThinking={true} />
      );

      expect(screen.getByText('thinking')).toBeInTheDocument();
      expect(screen.queryByText(/ctx/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    });

    it('should render all badge types together when all props are provided', () => {
      render(
        <ModelBadges
          contextLength="128K"
          pricing="$0.001 in / $0.002 out per 1M"
          modalities={['image']}
          supportsThinking={true}
          thinkingEnabled={true}
        />
      );

      expect(screen.getByText('128K ctx')).toBeInTheDocument();
      expect(screen.getByText('$0.001 in / $0.002 out per 1M')).toBeInTheDocument();
      expect(screen.getByText('image')).toBeInTheDocument();
      expect(screen.getByText('thinking')).toBeInTheDocument();
    });
  });

  // -- Snapshot --

  it('should match inline snapshot with thinking badge in muted state', () => {
    const { asFragment } = render(
      <ModelBadges
        contextLength="32K"
        pricing="$0.001 in / $0.002 out per 1M"
        modalities={['image']}
        supportsThinking={true}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div>
          <span>
            32K ctx
          </span>
          <span>
            $0.001 in / $0.002 out per 1M
          </span>
          <span>
            image
          </span>
          <span
            data-testid="brain-badge"
          >
            <span>
              <svg
                aria-hidden="true"
                fill="none"
                height="24"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 18V5"
                />
                <path
                  d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"
                />
                <path
                  d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"
                />
                <path
                  d="M17.997 5.125a4 4 0 0 1 2.526 5.77"
                />
                <path
                  d="M18 18a4 4 0 0 0 2-7.464"
                />
                <path
                  d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"
                />
                <path
                  d="M6 18a4 4 0 0 1-2-7.464"
                />
                <path
                  d="M6.003 5.125a4 4 0 0 0-2.526 5.77"
                />
              </svg>
              thinking
            </span>
          </span>
        </div>
      </DocumentFragment>
    `);
  });
});
