import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SkillsPanelContainer } from '../SkillsPanelContainer';

vi.mock('@/features/skills', () => ({
  SkillsContentContainer: () => <div data-testid="skills-content-sentinel" />,
}));

describe('SkillsPanelContainer', () => {
  it('renders the composed skills content', () => {
    render(<SkillsPanelContainer />);
    expect(screen.getByTestId('skills-content-sentinel')).toBeInTheDocument();
  });
});
