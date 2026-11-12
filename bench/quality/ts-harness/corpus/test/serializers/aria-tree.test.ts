/**
 * Tests for the aria-tree opt-in container snapshot helper (ADR-018 §L3).
 */

import { describe, expect, it } from 'vitest';

import { ariaTree } from './aria-tree';

function makeFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

function mount(html: string): HTMLElement {
  // Attach to document so id-based lookups (aria-labelledby, label[for]) resolve.
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();
  document.body.appendChild(wrapper);
  return wrapper;
}

describe('ariaTree', () => {
  describe('empty / trivial input', () => {
    it('should return empty string for empty fragment', () => {
      expect(ariaTree(document.createDocumentFragment())).toBe('');
    });

    it('should return empty string when only unsemantic wrappers are present', () => {
      const fragment = makeFragment('<div><span><div></div></span></div>');

      expect(ariaTree(fragment)).toBe('');
    });
  });

  describe('implicit roles from tag names', () => {
    it('should emit "button" for <button>', () => {
      const fragment = makeFragment('<button>Save</button>');

      expect(ariaTree(fragment)).toBe('- button "Save"');
    });

    it('should emit "link" for <a>', () => {
      const fragment = makeFragment('<a href="/x">Home</a>');

      expect(ariaTree(fragment)).toBe('- link "Home"');
    });

    it('should emit "heading" with level for <h1>..<h6>', () => {
      const fragment = makeFragment('<h2>Title</h2>');

      expect(ariaTree(fragment)).toBe('- heading "Title" (level=2)');
    });

    it('should emit "list" + "listitem" for <ul><li>', () => {
      const fragment = makeFragment('<ul><li>one</li><li>two</li></ul>');

      expect(ariaTree(fragment)).toBe(
        ['- list', '  - listitem "one"', '  - listitem "two"'].join('\n')
      );
    });

    it('should emit "navigation" for <nav> with no name (landmark roles do not inherit textContent)', () => {
      const fragment = makeFragment('<nav><a href="/x">x</a></nav>');

      expect(ariaTree(fragment)).toBe(['- navigation', '  - link "x"'].join('\n'));
    });

    it('should emit a named "navigation" only when aria-label is set explicitly', () => {
      const fragment = makeFragment('<nav aria-label="Primary"><a href="/x">x</a></nav>');

      expect(ariaTree(fragment)).toBe(['- navigation "Primary"', '  - link "x"'].join('\n'));
    });
  });

  describe('input type → role mapping', () => {
    it('should emit "checkbox" for input type=checkbox', () => {
      const fragment = makeFragment('<input type="checkbox" aria-label="Accept" />');

      expect(ariaTree(fragment)).toContain('- checkbox "Accept"');
    });

    it('should emit "radio" for input type=radio', () => {
      const fragment = makeFragment('<input type="radio" aria-label="Yes" />');

      expect(ariaTree(fragment)).toContain('- radio "Yes"');
    });

    it('should emit "textbox" for input type=text', () => {
      const fragment = makeFragment('<input type="text" aria-label="Name" />');

      expect(ariaTree(fragment)).toContain('- textbox "Name"');
    });

    it('should emit "searchbox" for input type=search', () => {
      const fragment = makeFragment('<input type="search" aria-label="Find" />');

      expect(ariaTree(fragment)).toContain('- searchbox "Find"');
    });

    it('should emit "button" for input type=submit', () => {
      const fragment = makeFragment('<input type="submit" aria-label="Go" />');

      expect(ariaTree(fragment)).toContain('- button "Go"');
    });
  });

  describe('explicit role overrides implicit', () => {
    it('should prefer role attribute over tag implicit role', () => {
      const fragment = makeFragment('<div role="dialog" aria-label="Settings">x</div>');

      expect(ariaTree(fragment)).toContain('- dialog "Settings"');
    });

    it('should emit role-only element even when tag has no implicit role', () => {
      const fragment = makeFragment('<span role="status">Loading</span>');

      expect(ariaTree(fragment)).toBe('- status "Loading"');
    });
  });

  describe('accessible name resolution', () => {
    it('should use aria-label when present', () => {
      const fragment = makeFragment('<button aria-label="Close">×</button>');

      expect(ariaTree(fragment)).toBe('- button "Close"');
    });

    it('should resolve aria-labelledby from a sibling by id', () => {
      const root = mount('<h2 id="t">Confirm delete</h2><button aria-labelledby="t">×</button>');
      try {
        const tree = ariaTree(root);
        expect(tree).toContain('- button "Confirm delete"');
      } finally {
        root.remove();
      }
    });

    it('should resolve label[for] for input', () => {
      const root = mount('<label for="i">Email</label><input id="i" type="text" />');
      try {
        expect(ariaTree(root)).toContain('- textbox "Email"');
      } finally {
        root.remove();
      }
    });

    it('should fall back to placeholder when no label is found', () => {
      const fragment = makeFragment('<input type="text" placeholder="Search…" />');

      expect(ariaTree(fragment)).toContain('- textbox "Search…"');
    });

    it('should use alt text for img', () => {
      const fragment = makeFragment('<img src="x.png" alt="Logo" />');

      expect(ariaTree(fragment)).toBe('- img "Logo"');
    });

    it('should fall back to textContent for generic roles', () => {
      const fragment = makeFragment('<button><span>Hello</span></button>');

      expect(ariaTree(fragment)).toBe('- button "Hello"');
    });

    it('should collapse whitespace in textContent', () => {
      const fragment = makeFragment('<button>  Hello\n  world  </button>');

      expect(ariaTree(fragment)).toBe('- button "Hello world"');
    });

    it('should truncate textContent beyond 80 chars', () => {
      const longText = 'x'.repeat(120);
      const fragment = makeFragment(`<button>${longText}</button>`);

      const output = ariaTree(fragment);
      expect(output).toContain('...');
      expect(output.length).toBeLessThan(120);
    });

    it('should escape double-quotes in accessible name', () => {
      const fragment = makeFragment('<button aria-label="Say &quot;hi&quot;">x</button>');

      expect(ariaTree(fragment)).toBe('- button "Say \\"hi\\""');
    });
  });

  describe('state annotations', () => {
    it('should annotate aria-expanded', () => {
      const fragment = makeFragment('<button aria-label="Menu" aria-expanded="true">Menu</button>');

      expect(ariaTree(fragment)).toContain('expanded=true');
    });

    it('should annotate aria-selected=true', () => {
      const fragment = makeFragment('<div role="tab" aria-selected="true">Tab</div>');

      expect(ariaTree(fragment)).toContain('selected');
    });

    it('should NOT annotate aria-selected=false', () => {
      const fragment = makeFragment('<div role="tab" aria-selected="false">Tab</div>');

      expect(ariaTree(fragment)).not.toContain('selected');
    });

    it('should annotate aria-checked', () => {
      const fragment = makeFragment('<input type="checkbox" aria-label="x" aria-checked="true" />');

      expect(ariaTree(fragment)).toContain('checked=true');
    });

    it('should annotate disabled buttons', () => {
      const fragment = makeFragment('<button disabled>Save</button>');

      expect(ariaTree(fragment)).toContain('disabled');
    });

    it('should annotate aria-disabled=true', () => {
      const fragment = makeFragment('<div role="button" aria-disabled="true">x</div>');

      expect(ariaTree(fragment)).toContain('disabled');
    });

    it('should annotate aria-current', () => {
      const fragment = makeFragment('<a href="/x" aria-current="page">X</a>');

      expect(ariaTree(fragment)).toContain('current=page');
    });

    it('should append [pressed] suffix for aria-pressed="true" button', () => {
      const fragment = makeFragment('<button aria-pressed="true">Bold</button>');

      expect(ariaTree(fragment)).toBe('- button "Bold"[pressed]');
    });

    it('should NOT append [pressed] for aria-pressed="false" button', () => {
      const fragment = makeFragment('<button aria-pressed="false">Bold</button>');

      expect(ariaTree(fragment)).toBe('- button "Bold"');
    });

    it('should combine multiple state annotations in one parenthetical', () => {
      const fragment = makeFragment(
        '<button disabled aria-label="x" aria-expanded="false">x</button>'
      );

      expect(ariaTree(fragment)).toContain('(expanded=false, disabled)');
    });
  });

  describe('visibility filtering', () => {
    it('should drop aria-hidden subtrees', () => {
      const fragment = makeFragment(
        '<div><button aria-label="Visible">v</button><button aria-hidden="true" aria-label="Hidden">h</button></div>'
      );

      const output = ariaTree(fragment);
      expect(output).toContain('Visible');
      expect(output).not.toContain('Hidden');
    });

    it('should drop elements with hidden attribute', () => {
      const fragment = makeFragment(
        '<div><button>Shown</button><button hidden>Gone</button></div>'
      );

      const output = ariaTree(fragment);
      expect(output).toContain('Shown');
      expect(output).not.toContain('Gone');
    });

    it('should drop elements with style display:none', () => {
      const fragment = makeFragment(
        '<div><button>Shown</button><button style="display: none">Gone</button></div>'
      );

      const output = ariaTree(fragment);
      expect(output).toContain('Shown');
      expect(output).not.toContain('Gone');
    });
  });

  describe('indentation and nesting', () => {
    it('should indent semantic children under a semantic parent', () => {
      const fragment = makeFragment(
        '<nav aria-label="Main"><a href="/a">A</a><a href="/b">B</a></nav>'
      );

      expect(ariaTree(fragment)).toBe(
        ['- navigation "Main"', '  - link "A"', '  - link "B"'].join('\n')
      );
    });

    it('should skip unsemantic wrappers without changing child indent', () => {
      const fragment = makeFragment(
        '<div><div><button>One</button></div><button>Two</button></div>'
      );

      expect(ariaTree(fragment)).toBe(['- button "One"', '- button "Two"'].join('\n'));
    });

    it('should produce stable output for a small Container-like shape', () => {
      const fragment = makeFragment(
        `
        <div role="dialog" aria-label="Settings">
          <h2>Appearance</h2>
          <div role="group" aria-label="Theme">
            <button aria-pressed="true">Light</button>
            <button>Dark</button>
            <button>System</button>
          </div>
        </div>
        `
      );

      expect(ariaTree(fragment)).toBe(
        [
          '- dialog "Settings"',
          '  - heading "Appearance" (level=2)',
          '  - group "Theme"',
          '    - button "Light"[pressed]',
          '    - button "Dark"',
          '    - button "System"',
        ].join('\n')
      );
    });
  });

  describe('input passthrough', () => {
    it('should accept a bare Element', () => {
      const el = document.createElement('button');
      el.textContent = 'X';

      expect(ariaTree(el)).toBe('- button "X"');
    });

    it('should accept a DocumentFragment', () => {
      const fragment = makeFragment('<button>X</button>');

      expect(ariaTree(fragment)).toBe('- button "X"');
    });
  });
});
