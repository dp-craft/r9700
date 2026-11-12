import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatSystemPromptChooser } from '../ChatSystemPromptChooser';

describe('ChatSystemPromptChooser', () => {
  it('matches snapshot with title and skill slot', () => {
    const { asFragment } = render(
      <ChatSystemPromptChooser
        title="System prompt"
        skillSlot={<div data-testid="skill-slot">skill</div>}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });
});
