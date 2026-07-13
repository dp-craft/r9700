import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionSkillIndicator, type SessionSkillIndicatorProps } from '../SessionSkillIndicator';

// -- Builders --

const buildContainer = (
  overrides?: Partial<{ id: string; name: string }>
): { readonly id: string; readonly name: string } => ({
  id: 'container-1',
  name: 'Writing Tools',
  ...overrides,
});

const buildSkill = (
  overrides?: Partial<{ id: string; name: string; selected: boolean }>
): { readonly id: string; readonly name: string; readonly selected: boolean } => ({
  id: 'skill-1',
  name: 'Grammar Check',
  selected: false,
  ...overrides,
});

const buildProps = (
  overrides?: Partial<SessionSkillIndicatorProps>
): SessionSkillIndicatorProps => ({
  selectedValue: '__none__',
  onSelect: vi.fn(),
  containers: [],
  skillNames: [],
  tokenCount: 0,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionSkillIndicator', () => {
  // -- Snapshot --

  it('should match snapshot when rendered with default props', () => {
    const { asFragment } = render(<SessionSkillIndicator {...buildProps()} />);

    expect(asFragment()).toMatchSnapshot();
  });

  it('should match snapshot when rendered with containers and individual skills', () => {
    const { asFragment } = render(
      <SessionSkillIndicator
        {...buildProps({
          selectedValue: 'pkg:container-1',
          containers: [buildContainer({ id: 'container-1', name: 'Writing Tools' })],
          individualSkills: [
            buildSkill({ id: 's1', name: 'Grammar', selected: true }),
            buildSkill({ id: 's2', name: 'Style', selected: false }),
          ],
          skillNames: ['Grammar'],
          tokenCount: 42,
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });

  // -- Trigger aria-label --

  it('should render trigger with changeAriaLabel from labels prop', () => {
    render(
      <SessionSkillIndicator
        {...buildProps({
          labels: {
            skillSetLabel: 'Skill Set',
            changeAriaLabel: 'Select skill set',
            selectSkillSetLabel: 'Choose a skill set',
            noSkillsInContainerLabel: 'No skills in container',
            noSkillsActiveLabel: 'No skills active',
            noSkillsOptionLabel: 'No skills',
            approximateTokenCountSuffix: '~{{count}} tokens',
            skillCountSingularLabel: '1 skill',
            skillCountPluralLabel: '{{count}} skills',
          },
        })}
      />
    );

    expect(screen.getByRole('combobox', { name: 'Select skill set' })).toBeInTheDocument();
  });

  // -- onSelect callback via controlled value contract --

  it('should call onSelect with pkg:<id> when a container option is chosen', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionSkillIndicator
        {...buildProps({
          onSelect,
          containers: [buildContainer({ id: 'c1', name: 'Writing Tools' })],
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Writing Tools' });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('pkg:c1');
  });

  it('should call onSelect with skill:<id> when an individual skill option is chosen', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionSkillIndicator
        {...buildProps({
          onSelect,
          individualSkills: [buildSkill({ id: 's1', name: 'Grammar Check', selected: false })],
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Grammar Check' });
    await user.click(option);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('skill:s1');
  });

  it('should call onSelect with __none__ when the no-skills option is chosen', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionSkillIndicator
        {...buildProps({
          onSelect,
          selectedValue: 'pkg:c1',
          containers: [buildContainer({ id: 'c1', name: 'Writing Tools' })],
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));
    const noSkillsOption = await screen.findByRole('option', { name: /no skills/i });
    await user.click(noSkillsOption);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('__none__');
  });

  it('should not call onSelect on initial render', () => {
    const onSelect = vi.fn();
    render(<SessionSkillIndicator {...buildProps({ onSelect })} />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  // -- Dropdown content when open --

  it('should show package group items and no-skills option after opening', async () => {
    const user = userEvent.setup();
    render(
      <SessionSkillIndicator
        {...buildProps({
          containers: [
            buildContainer({ id: 'c1', name: 'Writing Tools' }),
            buildContainer({ id: 'c2', name: 'Code Helpers' }),
          ],
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Writing Tools' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Code Helpers' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /no skills/i })).toBeInTheDocument();
  });

  it('should show individual skill group items after opening', async () => {
    const user = userEvent.setup();
    render(
      <SessionSkillIndicator
        {...buildProps({
          individualSkills: [
            buildSkill({ id: 's1', name: 'Grammar', selected: false }),
            buildSkill({ id: 's2', name: 'Style', selected: false }),
          ],
        })}
      />
    );

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Grammar' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Style' })).toBeInTheDocument();
  });

  // -- Token count display --

  it('should show token count when tokenCount > 0', () => {
    render(
      <SessionSkillIndicator
        {...buildProps({
          tokenCount: 42,
        })}
      />
    );

    expect(screen.getByText(/~42 tokens/i)).toBeInTheDocument();
  });

  it('should not show token count when tokenCount is 0', () => {
    render(<SessionSkillIndicator {...buildProps({ tokenCount: 0 })} />);

    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
  });

  it('should format large token counts with locale separators', () => {
    render(
      <SessionSkillIndicator
        {...buildProps({
          tokenCount: 1500,
        })}
      />
    );

    expect(screen.getByText(/~1,500 tokens|~1500 tokens/i)).toBeInTheDocument();
  });

  // -- Edge cases --

  it('should apply custom className to the wrapper element', () => {
    const { container } = render(
      <SessionSkillIndicator {...buildProps({ className: 'custom-indicator' })} />
    );

    expect(container.querySelector('.custom-indicator')).toBeInTheDocument();
  });

  it('should render with an empty containers list without crashing', () => {
    const { container } = render(<SessionSkillIndicator {...buildProps({ containers: [] })} />);

    expect(container).toBeTruthy();
  });
});
