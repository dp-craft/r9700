import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CuratedModelViewModel } from '../../types';
import type { ModelInfoDialogProps } from '../ModelInfoDialog';
import { ModelInfoDialog } from '../ModelInfoDialog';

// -- Test Data --

const buildModel = (overrides?: Partial<CuratedModelViewModel>): CuratedModelViewModel => ({
  baseName: 'llama3',
  displayName: 'Llama 3',
  description: 'A capable open model',
  approxSize: '4.7GB',
  pros: 'Fast, local',
  cons: 'Requires GPU',
  ...overrides,
});

// -- Builders --

const buildProps = (overrides?: Partial<ModelInfoDialogProps>): ModelInfoDialogProps => ({
  open: true,
  onOpenChange: vi.fn(),
  models: [buildModel()],
  searchQuery: '',
  onSearchChange: vi.fn(),
  titleLabel: 'Available Models',
  searchPlaceholder: 'Search models...',
  showingModelsLabel: 'Showing 1 of 1 models',
  nameLabel: 'Name',
  sizeLabel: 'Size',
  descriptionLabel: 'Description',
  prosLabel: 'Pros',
  consLabel: 'Cons',
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelInfoDialog', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ModelInfoDialog {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Provider guidance and availability --

  describe('provider guidance and availability', () => {
    describe('providerGuidance banner', () => {
      it('should render the guidance banner when providerGuidance is a non-null string', () => {
        render(
          <ModelInfoDialog
            {...buildProps({ providerGuidance: 'Configure your Ollama endpoint first.' })}
          />
        );

        expect(screen.getByText('Configure your Ollama endpoint first.')).toBeInTheDocument();
      });

      it('should apply bg-muted/60 class to the guidance banner element', () => {
        render(<ModelInfoDialog {...buildProps({ providerGuidance: 'Some guidance text' })} />);

        const banner = screen.getByText('Some guidance text');

        expect(banner.className).toContain('bg-muted/60');
      });

      it('should render the exact guidance text inside the banner', () => {
        const guidance = 'You must select a provider before browsing models.';
        render(<ModelInfoDialog {...buildProps({ providerGuidance: guidance })} />);

        expect(screen.getByText(guidance)).toBeInTheDocument();
      });

      it('should not render a guidance banner when providerGuidance is null', () => {
        render(<ModelInfoDialog {...buildProps({ providerGuidance: null })} />);

        expect(screen.queryByText(/bg-muted/)).not.toBeInTheDocument();
      });

      it('should not render a guidance banner when providerGuidance is undefined', () => {
        render(<ModelInfoDialog {...buildProps({ providerGuidance: undefined })} />);

        // The table is always rendered — verify no extra paragraph between header and table
        const allParagraphs = document.querySelectorAll('p');
        const guidanceParagraphs = Array.from(allParagraphs).filter(p =>
          p.className.includes('bg-muted/60')
        );

        expect(guidanceParagraphs).toHaveLength(0);
      });

      it('should not render a guidance banner when providerGuidance prop is omitted', () => {
        const { titleLabel } = buildProps();
        render(
          <ModelInfoDialog
            open={true}
            onOpenChange={vi.fn()}
            models={[buildModel()]}
            searchQuery=""
            onSearchChange={vi.fn()}
            titleLabel={titleLabel}
            searchPlaceholder="Search..."
            showingModelsLabel="Showing 1 model"
            nameLabel="Name"
            sizeLabel="Size"
            descriptionLabel="Description"
            prosLabel="Pros"
            consLabel="Cons"
          />
        );

        const allParagraphs = document.querySelectorAll('p');
        const guidanceParagraphs = Array.from(allParagraphs).filter(p =>
          p.className.includes('bg-muted/60')
        );

        expect(guidanceParagraphs).toHaveLength(0);
      });

      it('should render guidance alongside model rows without hiding them', () => {
        render(
          <ModelInfoDialog
            {...buildProps({
              providerGuidance: 'Important: set your API key.',
              models: [buildModel({ displayName: 'Llama 3' })],
            })}
          />
        );

        expect(screen.getByText('Important: set your API key.')).toBeInTheDocument();
        expect(screen.getByText('Llama 3')).toBeInTheDocument();
      });
    });

    describe('model availability indicator', () => {
      it('should show a green checkmark next to the model name when isAvailable is true', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: true })] })} />
        );

        const badge = screen.getByLabelText('Available');

        expect(badge).toBeInTheDocument();
        expect(badge).toHaveTextContent('✓');
      });

      it('should apply green color class to the availability checkmark', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: true })] })} />
        );

        const badge = screen.getByLabelText('Available');

        expect(badge.className).toContain('text-green-500');
      });

      it('should not show a checkmark when isAvailable is false', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: false })] })} />
        );

        expect(screen.queryByLabelText('Available')).not.toBeInTheDocument();
      });

      it('should not show a checkmark when isAvailable is undefined', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: undefined })] })} />
        );

        expect(screen.queryByLabelText('Available')).not.toBeInTheDocument();
      });

      it('should apply opacity-50 class to the row when isAvailable is false', () => {
        render(
          <ModelInfoDialog
            {...buildProps({
              models: [buildModel({ baseName: 'dimmed-model', isAvailable: false })],
            })}
          />
        );

        const modelNameCell = screen.getByText('Llama 3');
        const row = modelNameCell.closest('tr');

        expect(row?.className).toContain('opacity-50');
      });

      it('should not apply opacity-50 class when isAvailable is true', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: true })] })} />
        );

        const modelNameCell = screen.getByText('Llama 3');
        const row = modelNameCell.closest('tr');

        expect(row?.className).not.toContain('opacity-50');
      });

      it('should not apply opacity-50 class when isAvailable is undefined', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: undefined })] })} />
        );

        const modelNameCell = screen.getByText('Llama 3');
        const row = modelNameCell.closest('tr');

        expect(row?.className).not.toContain('opacity-50');
      });

      it('should render available and unavailable models in the same list with correct indicators', () => {
        render(
          <ModelInfoDialog
            {...buildProps({
              models: [
                buildModel({ baseName: 'model-a', displayName: 'Model A', isAvailable: true }),
                buildModel({ baseName: 'model-b', displayName: 'Model B', isAvailable: false }),
                buildModel({ baseName: 'model-c', displayName: 'Model C', isAvailable: undefined }),
              ],
            })}
          />
        );

        const availableBadges = screen.getAllByLabelText('Available');

        expect(availableBadges).toHaveLength(1);

        const rowA = screen.getByText('Model A').closest('tr');
        const rowB = screen.getByText('Model B').closest('tr');
        const rowC = screen.getByText('Model C').closest('tr');

        expect(rowA?.className).not.toContain('opacity-50');
        expect(rowB?.className).toContain('opacity-50');
        expect(rowC?.className).not.toContain('opacity-50');
      });
    });

    describe('edge cases', () => {
      it('should render guidance with very long text without crashing', () => {
        const longGuidance = 'G'.repeat(500);
        render(<ModelInfoDialog {...buildProps({ providerGuidance: longGuidance })} />);

        expect(screen.getByText(longGuidance)).toBeInTheDocument();
      });

      it('should render guidance with special characters correctly', () => {
        const specialGuidance = 'Use <API> key & "token" for \'auth\'';
        render(<ModelInfoDialog {...buildProps({ providerGuidance: specialGuidance })} />);

        expect(screen.getByText(specialGuidance)).toBeInTheDocument();
      });

      it('should handle empty models list with guidance shown', () => {
        render(
          <ModelInfoDialog {...buildProps({ models: [], providerGuidance: 'No models yet.' })} />
        );

        expect(screen.getByText('No models yet.')).toBeInTheDocument();
      });

      it('should transition from showing guidance to not showing it on rerender', () => {
        const { rerender } = render(
          <ModelInfoDialog {...buildProps({ providerGuidance: 'Initial guidance.' })} />
        );

        expect(screen.getByText('Initial guidance.')).toBeInTheDocument();

        rerender(<ModelInfoDialog {...buildProps({ providerGuidance: null })} />);

        expect(screen.queryByText('Initial guidance.')).not.toBeInTheDocument();
      });

      it('should transition from no guidance to showing guidance on rerender', () => {
        const { rerender } = render(
          <ModelInfoDialog {...buildProps({ providerGuidance: null })} />
        );

        expect(screen.queryByLabelText('Available')).not.toBeInTheDocument();

        rerender(
          <ModelInfoDialog {...buildProps({ providerGuidance: 'Now there is guidance.' })} />
        );

        expect(screen.getByText('Now there is guidance.')).toBeInTheDocument();
      });

      it('should transition a model from available to unavailable on rerender', () => {
        const { rerender } = render(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: true })] })} />
        );

        expect(screen.getByLabelText('Available')).toBeInTheDocument();

        rerender(
          <ModelInfoDialog {...buildProps({ models: [buildModel({ isAvailable: false })] })} />
        );

        expect(screen.queryByLabelText('Available')).not.toBeInTheDocument();

        const row = screen.getByText('Llama 3').closest('tr');

        expect(row?.className).toContain('opacity-50');
      });
    });
  });
});
