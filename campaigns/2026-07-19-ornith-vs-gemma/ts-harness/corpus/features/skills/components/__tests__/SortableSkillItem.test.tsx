import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SortableSkillItemProps } from '../SortableSkillItem';
import { SortableSkillItem } from '../SortableSkillItem';

// -- Builders --

const buildProps = (overrides?: Partial<SortableSkillItemProps>): SortableSkillItemProps => ({
  name: 'Test Skill',
  category: null,
  hasOrderingIssue: false,
  onRemove: vi.fn(),
  nodeRef: { current: null },
  style: {},
  dragHandleListeners: undefined,
  isDragging: false,
  ...overrides,
});

// -- Tests --

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SortableSkillItem', () => {
  // -- Smoke tests --

  it('should render without crashing with minimal valid props', () => {
    const { container } = render(<SortableSkillItem {...buildProps()} />);

    expect(container).toBeTruthy();
  });

  it('should render without crashing when isDragging is true', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ isDragging: true })} />);

    expect(container).toBeTruthy();
  });

  // -- Content tests --

  it('should render the skill name', () => {
    render(<SortableSkillItem {...buildProps({ name: 'Persona Expert' })} />);

    expect(screen.getByText('Persona Expert')).toBeInTheDocument();
  });

  it('should show category badge when category is set', () => {
    render(<SortableSkillItem {...buildProps({ category: 'persona' })} />);

    expect(screen.getByText('persona')).toBeInTheDocument();
  });

  it('should show all category badge variants', () => {
    const categories = ['persona', 'context', 'constraints', 'format', 'examples'] as const;

    categories.forEach(category => {
      const { unmount } = render(<SortableSkillItem {...buildProps({ category })} />);

      expect(screen.getByText(category)).toBeInTheDocument();
      unmount();
    });
  });

  it('should show uncategorized indicator when category is null', () => {
    render(<SortableSkillItem {...buildProps({ category: null })} />);

    const hasDash = screen.queryByText('—');
    const hasUncategorized = screen.queryByText(/uncategorized/i);

    expect(hasDash ?? hasUncategorized).toBeTruthy();
  });

  it('should render a remove button', () => {
    render(<SortableSkillItem {...buildProps()} />);

    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  // -- Callback tests --

  it('should call onRemove when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<SortableSkillItem {...buildProps({ onRemove })} />);

    await user.click(screen.getByRole('button', { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('should not call onRemove on initial render', () => {
    const onRemove = vi.fn();
    render(<SortableSkillItem {...buildProps({ onRemove })} />);

    expect(onRemove).not.toHaveBeenCalled();
  });

  // -- Drag handle tests --

  it('should render a drag handle element', () => {
    render(<SortableSkillItem {...buildProps()} />);

    const gripElement =
      screen.getByRole('button', { name: /drag/i }) ??
      screen.getByLabelText(/drag/i) ??
      screen.getByLabelText(/grip/i);

    expect(gripElement).toBeInTheDocument();
  });

  it('should spread dragHandleListeners on the drag handle', () => {
    const onPointerDown = vi.fn();
    const dragHandleListeners = { onPointerDown };
    render(<SortableSkillItem {...buildProps({ dragHandleListeners })} />);

    const gripElement = screen.getByRole('button', { name: /drag/i });
    gripElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(onPointerDown).toHaveBeenCalledOnce();
  });

  it('should render without errors when dragHandleListeners is undefined', () => {
    const { container } = render(
      <SortableSkillItem {...buildProps({ dragHandleListeners: undefined })} />
    );

    expect(container).toBeTruthy();
  });

  // -- Conditional rendering tests --

  it('should show warning highlight when hasOrderingIssue is true', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ hasOrderingIssue: true })} />);

    const rootElement = container.firstElementChild;
    const hasWarningClass =
      rootElement?.className.includes('amber') ||
      rootElement?.className.includes('yellow') ||
      rootElement?.className.includes('warning') ||
      rootElement?.className.includes('border');
    const hasWarningAttribute =
      rootElement?.getAttribute('data-warning') === 'true' ||
      rootElement?.getAttribute('data-ordering-issue') === 'true';

    expect(hasWarningClass || hasWarningAttribute).toBe(true);
  });

  it('should not show warning highlight when hasOrderingIssue is false', () => {
    const { container } = render(
      <SortableSkillItem {...buildProps({ hasOrderingIssue: false })} />
    );

    const rootElement = container.firstElementChild;
    const hasAmber = rootElement?.className.includes('amber');
    const hasYellow = rootElement?.className.includes('yellow');
    const hasWarning = rootElement?.className.includes('warning');
    const hasWarningAttr =
      rootElement?.getAttribute('data-warning') === 'true' ||
      rootElement?.getAttribute('data-ordering-issue') === 'true';

    expect(hasAmber || hasYellow || hasWarning || hasWarningAttr).toBeFalsy();
  });

  it('should apply reduced opacity or visual effect when isDragging is true', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ isDragging: true })} />);

    const rootElement = container.firstElementChild as HTMLElement;
    const hasOpacityClass = rootElement?.className.includes('opacity');
    const hasOpacityStyle = rootElement?.style.opacity !== '' && rootElement?.style.opacity !== '1';
    const hasDraggingClass = rootElement?.className.includes('dragging');

    expect(hasOpacityClass || hasOpacityStyle || hasDraggingClass).toBe(true);
  });

  it('should not apply reduced opacity when isDragging is false', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ isDragging: false })} />);

    const rootElement = container.firstElementChild as HTMLElement;
    const hasReducedOpacity =
      rootElement?.className.includes('opacity-50') ||
      rootElement?.className.includes('opacity-40') ||
      rootElement?.className.includes('opacity-30');

    expect(hasReducedOpacity).toBeFalsy();
  });

  // -- Style and ref props --

  it('should apply the provided style to the root element', () => {
    const { container } = render(
      <SortableSkillItem
        {...buildProps({
          style: { transform: 'translateY(10px)', transition: 'transform 200ms' },
        })}
      />
    );

    const rootElement = container.firstElementChild as HTMLElement;

    expect(rootElement.style.transform).toBe('translateY(10px)');
    expect(rootElement.style.transition).toBe('transform 200ms');
  });

  it('should apply nodeRef to the root element', () => {
    const nodeRef = React.createRef<HTMLElement>();
    render(<SortableSkillItem {...buildProps({ nodeRef })} />);

    expect(nodeRef.current).toBeInstanceOf(HTMLElement);
  });

  it('should apply className when provided', () => {
    const { container } = render(
      <SortableSkillItem {...buildProps({ className: 'custom-class' })} />
    );

    const rootElement = container.firstElementChild;

    expect(rootElement?.className).toContain('custom-class');
  });

  // -- Edge cases --

  it('should render with empty string name', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ name: '' })} />);

    expect(container).toBeTruthy();
  });

  it('should render with very long name', () => {
    const longName = 'A'.repeat(500);
    render(<SortableSkillItem {...buildProps({ name: longName })} />);

    expect(screen.getByText(longName)).toBeInTheDocument();
  });

  it('should render with special characters in name', () => {
    const specialName = '<script>alert("xss")</script>';
    render(<SortableSkillItem {...buildProps({ name: specialName })} />);

    expect(screen.getByText(specialName)).toBeInTheDocument();
  });

  it('should render with whitespace-only name', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ name: '   ' })} />);

    expect(container).toBeTruthy();
  });

  it('should render with empty style object', () => {
    const { container } = render(<SortableSkillItem {...buildProps({ style: {} })} />);

    expect(container).toBeTruthy();
  });

  it('should render correctly with both hasOrderingIssue and isDragging true', () => {
    const { container } = render(
      <SortableSkillItem {...buildProps({ hasOrderingIssue: true, isDragging: true })} />
    );

    expect(container).toBeTruthy();
  });

  it('should render category badge together with ordering issue warning', () => {
    render(<SortableSkillItem {...buildProps({ category: 'persona', hasOrderingIssue: true })} />);

    expect(screen.getByText('persona')).toBeInTheDocument();
  });

  it('should render with unicode characters in name', () => {
    const unicodeName = 'Skill \u{1F680} \u00E9\u00E0\u00FC';
    render(<SortableSkillItem {...buildProps({ name: unicodeName })} />);

    expect(screen.getByText(unicodeName)).toBeInTheDocument();
  });

  // -- Snapshot --

  it('should match snapshot with default props', () => {
    const { asFragment } = render(
      <SortableSkillItem
        {...buildProps({
          name: 'Snapshot Skill',
          category: 'persona',
          hasOrderingIssue: false,
          onRemove: vi.fn(),
          isDragging: false,
        })}
      />
    );

    expect(asFragment()).toMatchSnapshot();
  });
});
