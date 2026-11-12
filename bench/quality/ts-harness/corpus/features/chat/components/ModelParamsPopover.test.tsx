import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelParamsPopoverProps } from './ModelParamsPopover';
import { ModelParamsPopover } from './ModelParamsPopover';

// -- Builders --

const buildProps = (overrides?: Partial<ModelParamsPopoverProps>): ModelParamsPopoverProps => ({
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  contextSize: 4096,
  thinkingEnabled: false,
  thinkingBudget: 10240,
  supportsThinking: false,
  isAtDefaults: true,
  onTemperatureChange: vi.fn(),
  onMaxTokensChange: vi.fn(),
  onTopPChange: vi.fn(),
  onContextSizeChange: vi.fn(),
  onThinkingEnabledChange: vi.fn(),
  onThinkingBudgetChange: vi.fn(),
  onReset: vi.fn(),
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelParamsPopover', () => {
  // -- Smoke test --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<ModelParamsPopover {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render the Temperature slider label', () => {
    render(<ModelParamsPopover {...buildProps()} />);

    expect(screen.getByText('Temperature')).toBeInTheDocument();
  });

  it('should render the Max Tokens slider label', () => {
    render(<ModelParamsPopover {...buildProps()} />);

    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
  });

  it('should render the Top P slider label', () => {
    render(<ModelParamsPopover {...buildProps()} />);

    expect(screen.getByText('Top P')).toBeInTheDocument();
  });

  it('should render a numeric input showing the current temperature value', () => {
    render(<ModelParamsPopover {...buildProps({ temperature: 0.7 })} />);

    expect(screen.getByDisplayValue('0.7')).toBeInTheDocument();
  });

  it('should render a numeric input showing the current maxTokens value', () => {
    render(<ModelParamsPopover {...buildProps({ maxTokens: 2048 })} />);

    expect(screen.getByDisplayValue('2048')).toBeInTheDocument();
  });

  it('should render a numeric input showing the current topP value', () => {
    render(<ModelParamsPopover {...buildProps({ topP: 1.0 })} />);

    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
  });

  it('should render the reset button', () => {
    render(<ModelParamsPopover {...buildProps()} />);

    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
  });

  // -- Reset state tests --

  it('should disable the reset button when isAtDefaults is true', () => {
    render(<ModelParamsPopover {...buildProps({ isAtDefaults: true })} />);

    expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
  });

  it('should enable the reset button when isAtDefaults is false', () => {
    render(<ModelParamsPopover {...buildProps({ isAtDefaults: false })} />);

    expect(screen.getByRole('button', { name: /reset/i })).toBeEnabled();
  });

  // -- Callback tests --

  it('should call onReset when the reset button is clicked', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<ModelParamsPopover {...buildProps({ isAtDefaults: false, onReset })} />);

    await user.click(screen.getByRole('button', { name: /reset/i }));

    expect(onReset).toHaveBeenCalledOnce();
  });

  // -- Conditional rendering: thinking section --

  it('should not render a thinking toggle when supportsThinking is false', () => {
    render(<ModelParamsPopover {...buildProps({ supportsThinking: false })} />);

    expect(screen.queryByRole('switch', { name: /thinking/i })).not.toBeInTheDocument();
  });

  // -- Thinking section visible --

  it('should render thinking toggle when supportsThinking is true', () => {
    render(<ModelParamsPopover {...buildProps({ supportsThinking: true })} />);

    expect(screen.getByRole('switch', { name: /thinking/i })).toBeInTheDocument();
  });

  it('should not render thinking budget slider when thinkingEnabled is false', () => {
    render(
      <ModelParamsPopover {...buildProps({ supportsThinking: true, thinkingEnabled: false })} />
    );

    expect(screen.queryByDisplayValue('10240')).not.toBeInTheDocument();
  });

  it('should render thinking budget input when thinkingEnabled is true and supportsThinking is true', () => {
    render(
      <ModelParamsPopover
        {...buildProps({ supportsThinking: true, thinkingEnabled: true, thinkingBudget: 10240 })}
      />
    );

    expect(screen.getByDisplayValue('10240')).toBeInTheDocument();
  });

  // -- Thinking callbacks --

  it('should call onThinkingEnabledChange when thinking toggle is clicked', async () => {
    const user = userEvent.setup();
    const onThinkingEnabledChange = vi.fn();
    render(
      <ModelParamsPopover
        {...buildProps({ supportsThinking: true, thinkingEnabled: false, onThinkingEnabledChange })}
      />
    );

    await user.click(screen.getByRole('switch', { name: /thinking/i }));

    expect(onThinkingEnabledChange).toHaveBeenCalledOnce();
  });

  // -- Snapshot --

  it('should match inline snapshot', () => {
    const { asFragment } = render(
      <ModelParamsPopover
        {...buildProps({
          temperature: 0.7,
          maxTokens: 2048,
          topP: 1.0,
          isAtDefaults: true,
          supportsThinking: false,
        })}
      />
    );

    expect(asFragment()).toMatchInlineSnapshot(`
      <DocumentFragment>
        <div>
          <div>
            <div>
              <span>
                Temperature
              </span>
              <div>
                <input
                  aria-label="Temperature value"
                  max="2"
                  min="0"
                  step="0.1"
                  type="number"
                  value="0.7"
                />
                <button
                  data-slot="tooltip-trigger"
                  data-state="closed"
                  tabindex="0"
                  type="button"
                >
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
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                    />
                    <path
                      d="M12 16v-4"
                    />
                    <path
                      d="M12 8h.01"
                    />
                  </svg>
                  <span>
                    Info
                  </span>
                </button>
              </div>
            </div>
            <span
              aria-disabled="false"
              aria-label="Temperature"
              data-orientation="horizontal"
              data-slot="slider"
              dir="ltr"
            >
              <span
                data-orientation="horizontal"
                data-slot="slider-track"
              >
                <span
                  data-orientation="horizontal"
                  data-slot="slider-range"
                />
              </span>
              <span>
                <span
                  aria-orientation="horizontal"
                  aria-valuemax="2"
                  aria-valuemin="0"
                  aria-valuenow="0.7"
                  data-orientation="horizontal"
                  data-radix-collection-item=""
                  data-slot="slider-thumb"
                  role="slider"
                  tabindex="0"
                />
              </span>
            </span>
          </div>
          <div>
            <div>
              <span>
                Max Tokens
              </span>
              <div>
                <input
                  aria-label="Max Tokens value"
                  max="32768"
                  min="1"
                  step="1"
                  type="number"
                  value="2048"
                />
                <button
                  data-slot="tooltip-trigger"
                  data-state="closed"
                  tabindex="0"
                  type="button"
                >
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
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                    />
                    <path
                      d="M12 16v-4"
                    />
                    <path
                      d="M12 8h.01"
                    />
                  </svg>
                  <span>
                    Info
                  </span>
                </button>
              </div>
            </div>
            <span
              aria-disabled="false"
              aria-label="Max Tokens"
              data-orientation="horizontal"
              data-slot="slider"
              dir="ltr"
            >
              <span
                data-orientation="horizontal"
                data-slot="slider-track"
              >
                <span
                  data-orientation="horizontal"
                  data-slot="slider-range"
                />
              </span>
              <span>
                <span
                  aria-orientation="horizontal"
                  aria-valuemax="32768"
                  aria-valuemin="1"
                  aria-valuenow="2048"
                  data-orientation="horizontal"
                  data-radix-collection-item=""
                  data-slot="slider-thumb"
                  role="slider"
                  tabindex="0"
                />
              </span>
            </span>
          </div>
          <div>
            <div>
              <span>
                Top P
              </span>
              <div>
                <input
                  aria-label="Top P value"
                  max="1"
                  min="0"
                  step="0.05"
                  type="number"
                  value="1"
                />
                <button
                  data-slot="tooltip-trigger"
                  data-state="closed"
                  tabindex="0"
                  type="button"
                >
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
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                    />
                    <path
                      d="M12 16v-4"
                    />
                    <path
                      d="M12 8h.01"
                    />
                  </svg>
                  <span>
                    Info
                  </span>
                </button>
              </div>
            </div>
            <span
              aria-disabled="false"
              aria-label="Top P"
              data-orientation="horizontal"
              data-slot="slider"
              dir="ltr"
            >
              <span
                data-orientation="horizontal"
                data-slot="slider-track"
              >
                <span
                  data-orientation="horizontal"
                  data-slot="slider-range"
                />
              </span>
              <span>
                <span
                  aria-orientation="horizontal"
                  aria-valuemax="1"
                  aria-valuemin="0"
                  aria-valuenow="1"
                  data-orientation="horizontal"
                  data-radix-collection-item=""
                  data-slot="slider-thumb"
                  role="slider"
                  tabindex="0"
                />
              </span>
            </span>
          </div>
          <div>
            <div>
              <span>
                Context Size
              </span>
              <div>
                <input
                  aria-label="Context Size value"
                  max="131072"
                  min="512"
                  step="512"
                  type="number"
                  value="4096"
                />
                <button
                  data-slot="tooltip-trigger"
                  data-state="closed"
                  tabindex="0"
                  type="button"
                >
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
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                    />
                    <path
                      d="M12 16v-4"
                    />
                    <path
                      d="M12 8h.01"
                    />
                  </svg>
                  <span>
                    Info
                  </span>
                </button>
              </div>
            </div>
            <span
              aria-disabled="false"
              aria-label="Context Size"
              data-orientation="horizontal"
              data-slot="slider"
              dir="ltr"
            >
              <span
                data-orientation="horizontal"
                data-slot="slider-track"
              >
                <span
                  data-orientation="horizontal"
                  data-slot="slider-range"
                />
              </span>
              <span>
                <span
                  aria-orientation="horizontal"
                  aria-valuemax="131072"
                  aria-valuemin="512"
                  aria-valuenow="4096"
                  data-orientation="horizontal"
                  data-radix-collection-item=""
                  data-slot="slider-thumb"
                  role="slider"
                  tabindex="0"
                />
              </span>
            </span>
          </div>
          <div
            data-orientation="horizontal"
            data-slot="separator"
            role="none"
          />
          <button
            data-size="sm"
            data-slot="button"
            data-variant="ghost"
            disabled=""
          >
            Reset to defaults
          </button>
        </div>
      </DocumentFragment>
    `);
  });
});
