/**
 * Tests for the global class-strip snapshot serializer (ADR-018).
 *
 * The serializer is registered globally in `vite.config.ts`. These tests
 * exercise the plugin directly via `pretty-format` so we can verify the
 * stripping behaviour without depending on Vitest's snapshot runtime.
 */

import { format, plugins as defaultPlugins } from 'pretty-format';
import { describe, expect, it } from 'vitest';

import { classStripSerializer } from './class-strip';

// Mirror Vitest's runtime plugin chain: user plugins run before the built-in
// DOM plugins. Our class-strip plugin matches the root, clones + strips, marks
// the clone tree as processed, and delegates to DOMElement for the actual
// printing. When DOMElement recurses into children, our plugin's `test()`
// returns false (already marked) and DOMElement handles them.
function serialize(node: Node): string {
  return format(node, {
    plugins: [classStripSerializer, defaultPlugins.DOMElement, defaultPlugins.DOMCollection],
    printBasicPrototype: false,
    escapeString: false,
  });
}

function makeFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

describe('classStripSerializer', () => {
  it('should strip class attribute from a single element', () => {
    const fragment = makeFragment('<div class="foo bar">hi</div>');

    const output = serialize(fragment);

    expect(output).not.toContain('class=');
    expect(output).toContain('hi');
  });

  it('should strip style attribute from a single element', () => {
    const fragment = makeFragment('<div style="color: red">hi</div>');

    const output = serialize(fragment);

    expect(output).not.toContain('style=');
    expect(output).toContain('hi');
  });

  it('should strip class and style recursively from nested children', () => {
    const fragment = makeFragment(
      '<section class="outer"><span class="inner" style="font-size: 12px">deep</span></section>'
    );

    const output = serialize(fragment);

    expect(output).not.toContain('class=');
    expect(output).not.toContain('style=');
    expect(output).toContain('deep');
  });

  it('should preserve data-* attributes', () => {
    const fragment = makeFragment(
      '<button class="btn-primary" data-testid="save-button">Save</button>'
    );

    const output = serialize(fragment);

    expect(output).toContain('data-testid="save-button"');
    expect(output).not.toContain('class=');
  });

  it('should preserve aria-* attributes', () => {
    const fragment = makeFragment(
      '<button class="x" aria-label="Close dialog" aria-pressed="true">×</button>'
    );

    const output = serialize(fragment);

    expect(output).toContain('aria-label="Close dialog"');
    expect(output).toContain('aria-pressed="true"');
    expect(output).not.toContain('class=');
  });

  it('should preserve role and href and other structural attributes', () => {
    const fragment = makeFragment('<a class="link" href="/home" role="navigation">Home</a>');

    const output = serialize(fragment);

    expect(output).toContain('href="/home"');
    expect(output).toContain('role="navigation"');
    expect(output).not.toContain('class=');
  });

  it('should preserve text content unchanged', () => {
    const fragment = makeFragment('<div class="x"><p class="y">Hello, world.</p></div>');

    const output = serialize(fragment);

    expect(output).toContain('Hello, world.');
  });

  it('should not mutate the input DOM tree', () => {
    const fragment = makeFragment('<div class="keep-me" style="color: red">x</div>');
    const div = fragment.firstElementChild;

    serialize(fragment);

    expect(div?.getAttribute('class')).toBe('keep-me');
    expect(div?.getAttribute('style')).toBe('color: red');
  });

  it('should handle a bare Element (not just DocumentFragment)', () => {
    const div = document.createElement('div');
    div.className = 'remove-me';
    div.textContent = 'hello';

    const output = serialize(div);

    expect(output).not.toContain('class=');
    expect(output).toContain('hello');
  });

  it('should handle an empty fragment without throwing', () => {
    const fragment = document.createDocumentFragment();

    expect(() => serialize(fragment)).not.toThrow();
  });

  it('should keep multiple sibling elements with all their structural attrs', () => {
    const fragment = makeFragment(
      '<div><button class="a" data-testid="one">1</button><button class="b" data-testid="two">2</button></div>'
    );

    const output = serialize(fragment);

    expect(output).toContain('data-testid="one"');
    expect(output).toContain('data-testid="two"');
    expect(output).not.toContain('class="a"');
    expect(output).not.toContain('class="b"');
  });

  describe('test() predicate', () => {
    it('should return true for an Element', () => {
      const el = document.createElement('div');

      expect(classStripSerializer.test(el)).toBe(true);
    });

    it('should return true for a DocumentFragment', () => {
      expect(classStripSerializer.test(document.createDocumentFragment())).toBe(true);
    });

    it('should return false for a plain object', () => {
      expect(classStripSerializer.test({ foo: 'bar' })).toBe(false);
    });

    it('should return false for null', () => {
      expect(classStripSerializer.test(null)).toBe(false);
    });

    it('should return false for a string', () => {
      expect(classStripSerializer.test('not a node')).toBe(false);
    });

    it('should return false for a Text node (delegated to default printer)', () => {
      const text = document.createTextNode('hello');

      expect(classStripSerializer.test(text)).toBe(false);
    });
  });
});
