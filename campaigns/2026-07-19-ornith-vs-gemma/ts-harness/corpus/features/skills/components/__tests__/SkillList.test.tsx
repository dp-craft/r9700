import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillListItemVM } from '../../types';
import { SkillList } from '../SkillList';

// -- Types --

interface SkillListProps {
  readonly skills: readonly SkillListItemVM[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}

// -- Builders --

const buildSkillVM = (overrides?: Partial<SkillListItemVM>): SkillListItemVM => ({
  id: 'skill-1',
  name: 'Test Skill',
  type: 'custom',
  category: null,
  commandPrefix: null,
  description: null,
  ...overrides,
});

const buildProps = (overrides?: Partial<SkillListProps>): SkillListProps => ({
  skills: [buildSkillVM()],
  selectedId: null,
  onSelect: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SkillList', () => {
  // -- Smoke tests --

  it('should render without crashing with empty skills array', () => {
    const { container } = render(<SkillList {...buildProps({ skills: [] })} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing with skills', () => {
    const { container } = render(<SkillList {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render each skill name in the list', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Persona Expert' }),
      buildSkillVM({ id: 's2', name: 'Code Reviewer' }),
      buildSkillVM({ id: 's3', name: 'Summarizer' }),
    ];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('Persona Expert')).toBeInTheDocument();
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Summarizer')).toBeInTheDocument();
  });

  it('should show "built-in" badge for built-in skills', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Built-in Skill', type: 'builtin' }),
      buildSkillVM({ id: 's2', name: 'Custom Skill', type: 'custom' }),
    ];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('built-in')).toBeInTheDocument();
  });

  it('should not show "built-in" badge for custom skills', () => {
    const skills = [buildSkillVM({ id: 's1', name: 'Custom Skill', type: 'custom' })];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.queryByText('built-in')).not.toBeInTheDocument();
  });

  it('should show category badge when category is set', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Persona Skill', category: 'persona' }),
      buildSkillVM({ id: 's2', name: 'Context Skill', category: 'context' }),
    ];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('persona')).toBeInTheDocument();
    expect(screen.getByText('context')).toBeInTheDocument();
  });

  it('should show all category badge variants', () => {
    const categories = ['persona', 'context', 'constraints', 'format', 'examples'] as const;
    const skills = categories.map((category, i) =>
      buildSkillVM({ id: `s${i}`, name: `${category} Skill`, category })
    );
    render(<SkillList {...buildProps({ skills })} />);

    categories.forEach(category => {
      expect(screen.getByText(category)).toBeInTheDocument();
    });
  });

  it('should show uncategorized indicator when category is null', () => {
    const skills = [buildSkillVM({ id: 's1', name: 'Uncategorized Skill', category: null })];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('uncategorized')).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onSelect with skill id when a skill item is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const skills = [buildSkillVM({ id: 'skill-abc', name: 'Clickable Skill' })];
    render(<SkillList {...buildProps({ skills, onSelect })} />);

    await user.click(screen.getByText('Clickable Skill'));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('skill-abc');
  });

  it('should call onSelect with the correct id when multiple skills exist', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const skills = [
      buildSkillVM({ id: 's1', name: 'First Skill' }),
      buildSkillVM({ id: 's2', name: 'Second Skill' }),
      buildSkillVM({ id: 's3', name: 'Third Skill' }),
    ];
    render(<SkillList {...buildProps({ skills, onSelect })} />);

    await user.click(screen.getByText('Second Skill'));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('should not call onSelect on initial render', () => {
    const onSelect = vi.fn();
    render(<SkillList {...buildProps({ onSelect })} />);

    expect(onSelect).not.toHaveBeenCalled();
  });

  // -- Selection tests --

  it('should apply selected styling when selectedId matches a skill', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Selected Skill' }),
      buildSkillVM({ id: 's2', name: 'Other Skill' }),
    ];
    render(<SkillList {...buildProps({ skills, selectedId: 's1' })} />);

    const selectedItem =
      screen.getByText('Selected Skill').closest('[data-selected]') ??
      screen.getByText('Selected Skill').closest('[aria-selected]') ??
      screen.getByText('Selected Skill').closest('[aria-current]');

    expect(selectedItem).toBeTruthy();
  });

  it('should not apply selected styling when selectedId is null', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Skill A' }),
      buildSkillVM({ id: 's2', name: 'Skill B' }),
    ];
    render(<SkillList {...buildProps({ skills, selectedId: null })} />);

    const selectedItems = document.querySelectorAll(
      '[data-selected="true"], [aria-selected="true"], [aria-current="true"]'
    );

    expect(selectedItems).toHaveLength(0);
  });

  it('should not apply selected styling to non-matching skills', () => {
    const skills = [
      buildSkillVM({ id: 's1', name: 'Selected Skill' }),
      buildSkillVM({ id: 's2', name: 'Other Skill' }),
    ];
    render(<SkillList {...buildProps({ skills, selectedId: 's1' })} />);

    const otherItem =
      screen.getByText('Other Skill').closest('[data-selected="true"]') ??
      screen.getByText('Other Skill').closest('[aria-selected="true"]') ??
      screen.getByText('Other Skill').closest('[aria-current="true"]');

    expect(otherItem).toBeNull();
  });

  // -- Edge cases --

  it('should render skills with command prefix', () => {
    const skills = [buildSkillVM({ id: 's1', name: 'Prefixed Skill', commandPrefix: '/expert' })];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('/expert')).toBeInTheDocument();
  });

  it('should not render command prefix when it is null', () => {
    const skills = [buildSkillVM({ id: 's1', name: 'No Prefix Skill', commandPrefix: null })];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('No Prefix Skill')).toBeInTheDocument();
    expect(screen.queryByText('/')).not.toBeInTheDocument();
  });

  it('should render a large number of skills', () => {
    const skills = Array.from({ length: 50 }, (_, i) =>
      buildSkillVM({ id: `s${i}`, name: `Skill ${i}` })
    );
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('Skill 0')).toBeInTheDocument();
    expect(screen.getByText('Skill 49')).toBeInTheDocument();
  });

  it('should handle skill with very long name', () => {
    const longName = 'A'.repeat(200);
    const skills = [buildSkillVM({ id: 's1', name: longName })];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it('should handle selectedId that does not match any skill', () => {
    const skills = [buildSkillVM({ id: 's1', name: 'Existing Skill' })];
    const { container } = render(
      <SkillList {...buildProps({ skills, selectedId: 'nonexistent-id' })} />
    );

    expect(container).toBeTruthy();
    expect(screen.getByText('Existing Skill')).toBeInTheDocument();
  });

  it('should render both built-in badge and category badge on the same skill', () => {
    const skills = [
      buildSkillVM({
        id: 's1',
        name: 'Builtin Persona',
        type: 'builtin',
        category: 'persona',
      }),
    ];
    render(<SkillList {...buildProps({ skills })} />);

    expect(screen.getByText('built-in')).toBeInTheDocument();
    expect(screen.getByText('persona')).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match inline snapshot with default props', () => {
    const { asFragment } = render(
      <SkillList
        {...buildProps({
          skills: [
            buildSkillVM({
              id: 'snap-1',
              name: 'Snapshot Skill',
              type: 'custom',
              category: 'persona',
              commandPrefix: '/snap',
            }),
          ],
          selectedId: null,
          onSelect: vi.fn(),
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
