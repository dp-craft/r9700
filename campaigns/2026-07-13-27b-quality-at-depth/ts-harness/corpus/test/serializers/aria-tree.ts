/**
 * Accessibility-tree serializer for Container / HOC snapshots.
 *
 * Produces a hierarchical, structure-only string that represents the
 * accessibility tree of a DOM subtree: role + accessible name + key state.
 * Intentionally drops: className, style, layout wrappers without role,
 * data-* attributes (those belong in class-strip DOM snapshots, not here).
 *
 * Use this for L2 container smoke + snapshot tests where the assertion is
 * "the right user-perceivable structure rendered" — not which specific divs
 * wrap which other divs.
 *
 *   import { ariaTree } from '@/test/serializers/aria-tree';
 *   expect(ariaTree(container)).toMatchInlineSnapshot(`
 *     - dialog "Settings"
 *       - heading "Appearance" level=2
 *       - button "Light"
 *       - button "Dark"
 *       - button "System"
 *   `);
 *
 * Maintenance cost: low — copy changes (i18n value, layout reshuffle) only
 * touch one or two lines. Run `vitest -u` to refresh. The diff names the
 * regression unambiguously (extra/missing role + name pair).
 */

const ROLE_FROM_TAG: Readonly<Record<string, string>> = {
  A: 'link',
  ARTICLE: 'article',
  ASIDE: 'complementary',
  BUTTON: 'button',
  DIALOG: 'dialog',
  FIELDSET: 'group',
  FIGURE: 'figure',
  FOOTER: 'contentinfo',
  FORM: 'form',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  HEADER: 'banner',
  HR: 'separator',
  IMG: 'img',
  INPUT: 'textbox', // refined below by `type` attr
  LABEL: 'label',
  LI: 'listitem',
  MAIN: 'main',
  NAV: 'navigation',
  OL: 'list',
  OPTION: 'option',
  PROGRESS: 'progressbar',
  SECTION: 'region',
  SELECT: 'combobox',
  TABLE: 'table',
  TEXTAREA: 'textbox',
  TBODY: 'rowgroup',
  TD: 'cell',
  TFOOT: 'rowgroup',
  TH: 'columnheader',
  THEAD: 'rowgroup',
  TR: 'row',
  UL: 'list',
};

const INPUT_TYPE_ROLE: Readonly<Record<string, string>> = {
  button: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  search: 'searchbox',
  submit: 'button',
  reset: 'button',
};

function explicitRole(el: Element): string | undefined {
  return el.getAttribute('role') ?? undefined;
}

function implicitRole(el: Element): string | undefined {
  if (el.tagName === 'INPUT') {
    const type = el.getAttribute('type')?.toLowerCase() ?? 'text';
    return INPUT_TYPE_ROLE[type] ?? 'textbox';
  }
  return ROLE_FROM_TAG[el.tagName];
}

function role(el: Element): string | undefined {
  return explicitRole(el) ?? implicitRole(el);
}

// Roles whose accessible name SHOULD fall back to textContent when no aria-*
// labelling is present. Container/landmark roles are excluded — using their
// textContent as a "name" produces meaningless concatenations of every nested
// element's text (e.g. a <ul> would be named "onetwo").
const TEXT_NAMEABLE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'link',
  'heading',
  'cell',
  'columnheader',
  'listitem',
  'option',
  'tab',
  'menuitem',
  'switch',
  'status',
  'label',
]);

function accessibleName(el: Element, currentRole: string | undefined): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refs = labelledBy
      .split(/\s+/)
      .map(id => el.ownerDocument?.getElementById(id)?.textContent?.trim() ?? '')
      .filter(s => s.length > 0);
    if (refs.length > 0) return refs.join(' ');
  }

  if (el.tagName === 'IMG') {
    return el.getAttribute('alt')?.trim() ?? undefined;
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    const id = el.getAttribute('id');
    if (id) {
      const label = el.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`);
      const text = label?.textContent?.trim();
      if (text) return text;
    }
    return el.getAttribute('placeholder')?.trim() ?? undefined;
  }

  if (currentRole !== undefined && !TEXT_NAMEABLE_ROLES.has(currentRole)) {
    return undefined;
  }

  const text = el.textContent?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

function stateAnnotations(el: Element): string {
  const parts: string[] = [];

  if (el.tagName.match(/^H[1-6]$/)) {
    parts.push(`level=${el.tagName[1]}`);
  }

  const ariaExpanded = el.getAttribute('aria-expanded');
  if (ariaExpanded) parts.push(`expanded=${ariaExpanded}`);

  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected === 'true') parts.push('selected');

  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked && ariaChecked !== 'false') parts.push(`checked=${ariaChecked}`);

  const ariaDisabled = el.getAttribute('aria-disabled');
  if (ariaDisabled === 'true' || (el as HTMLButtonElement).disabled === true) {
    parts.push('disabled');
  }

  if (el.hasAttribute('aria-current')) {
    parts.push(`current=${el.getAttribute('aria-current')}`);
  }

  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function isHidden(el: Element): boolean {
  return (
    el.getAttribute('aria-hidden') === 'true' ||
    el.hasAttribute('hidden') ||
    (el as HTMLElement).style?.display === 'none'
  );
}

function quoteName(name: string): string {
  // Escape quotes inside the accessible name for cleaner snapshots.
  return `"${name.replace(/"/g, '\\"')}"`;
}

function walk(node: Node, indent: number, lines: string[]): void {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;

  if (isHidden(el)) return;

  const r = role(el);
  const recurseIndent = r ? indent + 1 : indent;

  if (r) {
    const name = accessibleName(el, r);
    const namePart = name ? ` ${quoteName(name)}` : '';
    const pressedPart = el.getAttribute('aria-pressed') === 'true' ? '[pressed]' : '';
    const state = stateAnnotations(el);
    lines.push(`${'  '.repeat(indent)}- ${r}${namePart}${pressedPart}${state}`);
  }

  el.childNodes.forEach(child => {
    walk(child, recurseIndent, lines);
  });
}

/**
 * Produce an accessibility-tree string for snapshot assertions.
 * Accepts an Element or DocumentFragment (e.g. the return of RTL's
 * `render(...).container` or `asFragment()`).
 */
export function ariaTree(root: Element | DocumentFragment): string {
  const lines: string[] = [];
  // For a bare Element, walk the element itself. For a DocumentFragment, walk
  // its children (the fragment is a non-rendered container).
  if (root.nodeType === Node.ELEMENT_NODE) {
    walk(root, 0, lines);
  } else {
    root.childNodes.forEach(child => {
      walk(child, 0, lines);
    });
  }
  return lines.join('\n');
}
