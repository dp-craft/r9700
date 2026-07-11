import type { ModelMessage } from 'ai';

// In-loop history compaction for the AI-SDK multi-step tool loop. Each step
// resends the whole accumulated transcript, so a long run pays O(steps²) for the
// big tool outputs (file reads, greps) it already acted on. This shrinks stale
// tool-result payloads to a short marker — keeping tool-call/result pairing and
// the freshest copy of every target — so the resent transcript stays bounded.
// Pure: produces a NEW message list and never mutates the input.

export const DEFAULT_COMPACTION_WINDOW = 10;
// Results at or below this many characters are never worth eliding (the marker
// itself costs ~80 chars; short write/edit/grep acks stay verbatim).
export const COMPACTION_FLOOR_CHARS = 400;
export const RUNNER_COMPACTED_MARKER = 'runner-compacted';

const COMPACTION_WINDOW_ENV = 'RUNNER_COMPACTION_WINDOW';

// Sliding-window size (most-recent large, non-superseded results kept verbatim).
// `0` (or negative / NaN→default) disables compaction entirely.
export const resolveCompactionWindow = (): number => {
  const parsed = Number(process.env[COMPACTION_WINDOW_ENV] ?? DEFAULT_COMPACTION_WINDOW);
  return Number.isNaN(parsed) ? DEFAULT_COMPACTION_WINDOW : Math.floor(parsed);
};

interface ToolCallPartLike {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

interface ToolResultPartLike {
  readonly type: 'tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: { readonly type: string; readonly value?: unknown };
}

const isToolCallPart = (part: unknown): part is ToolCallPartLike =>
  typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool-call';

const isToolResultPart = (part: unknown): part is ToolResultPartLike =>
  typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'tool-result';

// Stable target identity. Reads/writes/edits on the same path share a key so a
// later edit (or re-read) supersedes an earlier read; grep/lsp/bash key off their
// query so an identical re-run supersedes the prior one.
const stripDot = (p: string): string => p.replace(/^\.\//, '');

const str = (rec: Record<string, unknown>, key: string): string =>
  typeof rec[key] === 'string' ? (rec[key] as string) : '';

const targetKey = (toolName: string, input: unknown): string => {
  const rec = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
    case 'verify_edit':
      return `file:${stripDot(str(rec, 'path'))}`;
    case 'grep':
      return `grep:${str(rec, 'pattern')}`;
    case 'lsp':
      return `lsp:${str(rec, 'op')}:${str(rec, 'symbol')}:${stripDot(str(rec, 'file'))}`;
    case 'bash': {
      const args = Array.isArray(rec.args) ? (rec.args as readonly unknown[]).join(' ') : '';
      return `bash:${str(rec, 'command')} ${args}`.trim();
    }
    default:
      return `${toolName}:${JSON.stringify(rec)}`;
  }
};

// Character cost of a tool-result payload (what the model actually re-reads).
const outputChars = (output: ToolResultPartLike['output']): number => {
  if (output.type === 'text') {
    return typeof output.value === 'string' ? output.value.length : 0;
  }
  if (output.type === 'json') {
    return JSON.stringify(output.value ?? null).length;
  }
  return 0;
};

interface ResultRef {
  readonly msgIdx: number;
  readonly partIdx: number;
  readonly order: number;
  readonly key: string;
  readonly chars: number;
}

const coord = (r: { msgIdx: number; partIdx: number }): string => `${r.msgIdx}:${r.partIdx}`;

// Map every tool-call id to its target key, so a tool-result (which carries only
// the id) can be grouped with re-reads / edits of the same target.
const buildKeyByCallId = (messages: readonly ModelMessage[]): ReadonlyMap<string, string> => {
  const entries = messages.flatMap((m): Array<readonly [string, string]> =>
    Array.isArray(m.content)
      ? m.content
          .filter(isToolCallPart)
          .map((p): readonly [string, string] => [p.toolCallId, targetKey(p.toolName, p.input)])
      : []
  );
  return new Map(entries);
};

// Locate every tool-result part with its document order and target key.
const collectResults = (
  messages: readonly ModelMessage[],
  keyByCallId: ReadonlyMap<string, string>
): readonly ResultRef[] => {
  const refs: ResultRef[] = [];
  messages.forEach((m, msgIdx): void => {
    if (!Array.isArray(m.content)) return;
    m.content.forEach((part: unknown, partIdx: number): void => {
      if (!isToolResultPart(part)) return;
      refs.push({
        msgIdx,
        partIdx,
        order: refs.length,
        key: keyByCallId.get(part.toolCallId) ?? `unmatched:${part.toolCallId}`,
        chars: outputChars(part.output),
      });
    });
  });
  return refs;
};

// Decide which result coordinates to elide: any large result superseded by a
// later result of the same target, plus large survivors older than the most
// recent `window`.
const elideCoords = (results: readonly ResultRef[], window: number): ReadonlySet<string> => {
  const lastOrderByKey = new Map<string, number>();
  results.forEach((r): void => {
    const prev = lastOrderByKey.get(r.key);
    if (prev === undefined || r.order > prev) lastOrderByKey.set(r.key, r.order);
  });
  const large = results.filter((r): boolean => r.chars > COMPACTION_FLOOR_CHARS);
  const superseded = large.filter((r): boolean => r.order < (lastOrderByKey.get(r.key) ?? r.order));
  const supersededCoords = new Set(superseded.map(coord));
  // Survivors stay in document order (filter preserves it), so the slice elides
  // the OLDEST beyond the most-recent `window`.
  const survivors = large.filter((r): boolean => !supersededCoords.has(coord(r)));
  const windowElided =
    survivors.length > window ? survivors.slice(0, survivors.length - window) : [];
  return new Set([...supersededCoords, ...windowElided.map(coord)]);
};

const elidedMarker = (toolName: string, chars: number): { type: 'text'; value: string } => ({
  type: 'text',
  value: `…[${RUNNER_COMPACTED_MARKER}: ${chars} chars of a superseded ${toolName} result omitted to save context; the current version is already shown above]…`,
});

// Rebuild messages, replacing only the chosen tool-result payloads. Structure,
// ids, and every non-elided part keep their original reference (immutability).
const rewriteMessages = (
  messages: readonly ModelMessage[],
  elide: ReadonlySet<string>
): ModelMessage[] =>
  messages.map((m, msgIdx): ModelMessage => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((part: unknown, partIdx: number): unknown =>
      isToolResultPart(part) && elide.has(`${msgIdx}:${partIdx}`)
        ? { ...part, output: elidedMarker(part.toolName, outputChars(part.output)) }
        : part
    );
    const changed = content.some((part, i): boolean => part !== m.content[i]);
    return changed ? ({ ...m, content } as ModelMessage) : m;
  });

export const compactMessages = (
  messages: readonly ModelMessage[],
  window: number = resolveCompactionWindow()
): ModelMessage[] => {
  if (window <= 0) return [...messages];
  const keyByCallId = buildKeyByCallId(messages);
  const results = collectResults(messages, keyByCallId);
  const elide = elideCoords(results, window);
  return elide.size === 0 ? [...messages] : rewriteMessages(messages, elide);
};
