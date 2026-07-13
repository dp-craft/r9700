import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DataManagementLabels, DataManagementSectionProps } from '../DataManagementSection';
import { DataManagementSection } from '../DataManagementSection';

// -- Builders --

const buildLabels = (overrides?: Partial<DataManagementLabels>): DataManagementLabels => ({
  title: 'Data Management',
  description: 'Export or import your data.',
  exportButton: 'Export Data',
  importButton: 'Import Data',
  exportingLabel: 'Exporting...',
  importingLabel: 'Importing...',
  ...overrides,
});

const buildProps = (
  overrides?: Partial<DataManagementSectionProps>
): DataManagementSectionProps => ({
  onExport: vi.fn(),
  onImport: vi.fn(),
  isExporting: false,
  isImporting: false,
  labels: buildLabels(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DataManagementSection', () => {
  // -- Smoke test --

  it('should render section heading and description', () => {
    render(<DataManagementSection {...buildProps()} />);

    expect(screen.getByRole('heading', { name: 'Data Management' })).toBeInTheDocument();
    expect(screen.getByText('Export or import your data.')).toBeInTheDocument();
  });

  // -- Content tests --

  it('should display export button text from labels', () => {
    render(<DataManagementSection {...buildProps()} />);

    expect(screen.getByRole('button', { name: 'Export Data' })).toBeInTheDocument();
  });

  it('should display import button text from labels', () => {
    render(<DataManagementSection {...buildProps()} />);

    expect(screen.getByRole('button', { name: 'Import Data' })).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onExport when export button is clicked', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<DataManagementSection {...buildProps({ onExport })} />);

    await user.click(screen.getByRole('button', { name: 'Export Data' }));

    expect(onExport).toHaveBeenCalledOnce();
  });

  it('should call onImport when import button is clicked', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    render(<DataManagementSection {...buildProps({ onImport })} />);

    await user.click(screen.getByRole('button', { name: 'Import Data' }));

    expect(onImport).toHaveBeenCalledOnce();
  });

  it('should not call onExport or onImport on initial render', () => {
    const onExport = vi.fn();
    const onImport = vi.fn();
    render(<DataManagementSection {...buildProps({ onExport, onImport })} />);

    expect(onExport).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  // -- Conditional rendering — exporting state --

  it('should show exporting label and disable export button when isExporting is true', () => {
    render(
      <DataManagementSection
        {...buildProps({
          isExporting: true,
          labels: buildLabels({ exportingLabel: 'Exporting...' }),
        })}
      />
    );

    expect(screen.getByText('Exporting...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('should disable import button when isExporting is true', () => {
    render(<DataManagementSection {...buildProps({ isExporting: true })} />);

    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });

  // -- Conditional rendering — importing state --

  it('should show importing label and disable import button when isImporting is true', () => {
    render(
      <DataManagementSection
        {...buildProps({
          isImporting: true,
          labels: buildLabels({ importingLabel: 'Importing...' }),
        })}
      />
    );

    expect(screen.getByText('Importing...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });

  it('should disable export button when isImporting is true', () => {
    render(<DataManagementSection {...buildProps({ isImporting: true })} />);

    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  // -- Edge cases --

  it('should render with empty string labels without crashing', () => {
    const { container } = render(
      <DataManagementSection
        {...buildProps({
          labels: buildLabels({
            title: '',
            description: '',
            exportButton: '',
            importButton: '',
          }),
        })}
      />
    );

    expect(container).toBeTruthy();
  });

  it('should render labels with special characters', () => {
    render(
      <DataManagementSection
        {...buildProps({
          labels: buildLabels({
            title: 'Adatkezelés (új)',
            description: 'Exportálja vagy importálja adatait.',
          }),
        })}
      />
    );

    expect(screen.getByRole('heading', { name: 'Adatkezelés (új)' })).toBeInTheDocument();
    expect(screen.getByText('Exportálja vagy importálja adatait.')).toBeInTheDocument();
  });

  it('should render custom label text on buttons', () => {
    render(
      <DataManagementSection
        {...buildProps({
          labels: buildLabels({
            exportButton: 'Adatok exportálása',
            importButton: 'Adatok importálása',
          }),
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'Adatok exportálása' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adatok importálása' })).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <DataManagementSection
        {...buildProps({
          onExport: vi.fn(),
          onImport: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
