import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatChoosersStrip } from '../ChatChoosersStrip';

describe('ChatChoosersStrip', () => {
  it('matches snapshot with both chooser slots', () => {
    const { asFragment } = render(
      <ChatChoosersStrip
        modelChooserSlot={<div data-testid="model-slot">model</div>}
        systemPromptChooserSlot={<div data-testid="prompt-slot">prompt</div>}
      />
    );
    expect(asFragment()).toMatchSnapshot();
  });

  it('renders both chooser rows with their testid attributes', () => {
    const { container } = render(
      <ChatChoosersStrip
        modelChooserSlot={<div data-testid="model-slot">model</div>}
        systemPromptChooserSlot={<div data-testid="prompt-slot">prompt</div>}
      />
    );
    expect(container.querySelector('[data-model-row]')).not.toBeNull();
    expect(container.querySelector('[data-skill-row]')).not.toBeNull();
  });
});
