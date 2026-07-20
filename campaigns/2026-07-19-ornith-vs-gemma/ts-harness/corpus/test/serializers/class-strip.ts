/**
 * pretty-format plugin that strips noisy presentational attributes from DOM
 * snapshots before delegating to the default DOMElement printer.
 *
 * Default attributes dropped: `class`, `style`.
 *
 * Why: Tailwind utility classes change with every minor design tweak. Their
 * presence in inline snapshots produces high-churn diffs that mask real
 * structural regressions. The snapshot value we want to assert is the DOM
 * skeleton (tag tree, ARIA attrs, data-testid, text), not the styling.
 *
 * Registration: `vite.config.ts` → `test.snapshotSerializers`.
 *
 * Opt-out for a single test (if class assertion is genuinely the subject):
 *
 *   import { rawDOM } from '@/test/serializers';
 *   expect(rawDOM(container)).toMatchInlineSnapshot(...);
 */

import { plugins as defaultPlugins } from 'pretty-format';

const ATTRS_TO_STRIP: ReadonlySet<string> = new Set(['class', 'style']);

const PROCESSED = new WeakSet<Node>();

function isDomNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    'nodeType' in value &&
    typeof (value as { nodeType: unknown }).nodeType === 'number'
  );
}

function isSerializableRoot(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE;
}

function stripDeep(node: Node): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    for (const attr of ATTRS_TO_STRIP) {
      el.removeAttribute(attr);
    }
  }
  node.childNodes.forEach(stripDeep);
}

function markDeep(node: Node, set: WeakSet<Node>): void {
  set.add(node);
  node.childNodes.forEach(child => {
    markDeep(child, set);
  });
}

interface PrettyFormatPlugin {
  test: (value: unknown) => boolean;
  serialize: (
    value: unknown,
    config: unknown,
    indentation: string,
    depth: number,
    refs: unknown,
    printer: unknown
  ) => string;
}

const defaultDomPlugin = defaultPlugins.DOMElement as unknown as PrettyFormatPlugin;

export const classStripSerializer: PrettyFormatPlugin = {
  test(value: unknown): boolean {
    if (!isDomNode(value)) return false;
    if (!isSerializableRoot(value)) return false;
    return !PROCESSED.has(value);
  },
  serialize(value, config, indentation, depth, refs, printer): string {
    const original = value as Node;
    const cloned = original.cloneNode(true);
    stripDeep(cloned);
    markDeep(cloned, PROCESSED);
    return defaultDomPlugin.serialize(cloned, config, indentation, depth, refs, printer);
  },
};

export default classStripSerializer;
