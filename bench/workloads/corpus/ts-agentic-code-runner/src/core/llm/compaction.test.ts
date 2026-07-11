import type { ModelMessage } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPACTION_FLOOR_CHARS,
  compactMessages,
  DEFAULT_COMPACTION_WINDOW,
  resolveCompactionWindow,
  RUNNER_COMPACTED_MARKER } from './compaction';

// Builders for the AI-SDK ModelMessage shapes the runner's tool loop produces.
const big = (tag: string): string => `${tag}:${'x'.repeat(COMPACTION_FLOOR_CHARS + 100)}`;

const call = (id: string, toolName: string, input: Record<string, unknown>): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName, input }],
});

const textResult = (id: string, toolName: string, value: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName, output: { type: 'text', value } }],
});

const jsonResult = (
  id: string,
  toolName: string,
  value: Record<string, string | number | boolean>
): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName, output: { type: 'json', value } }],
});

// Pull the textual value out of the single tool-result part of a tool message.
const resultValue = (m: ModelMessage): string => {
  const part = (m.content as ReadonlyArray<Record<string, unknown>>)[0];
  const output = part.output as { type: string; value?: unknown };
  return output.type === 'text' ? String(output.value) : JSON.stringify(output.value);
};

describe('compactMessages', () => {
  it('should leave a conversation with no tool results unchanged', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'kickoff' },
      { role: 'assistant', content: 'plain reply' },
    ];

    expect(compactMessages(messages, 10)).toEqual(messages);
  });

  it('should elide an earlier read result that a later read of the same file supersedes', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'kickoff' },
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', big('A-v1')),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', big('A-v2')),
    ];

    const out = compactMessages(messages, 10);

    expect(resultValue(out[2])).toContain(RUNNER_COMPACTED_MARKER);
    expect(resultValue(out[2])).not.toContain('x'.repeat(COMPACTION_FLOOR_CHARS));
    expect(resultValue(out[4])).toBe(big('A-v2'));
  });

  it('should elide a read result that a later edit of the same file supersedes', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', big('A')),
      call('c2', 'edit', { path: 'src/a.ts', anchor: 'a', replacement: 'b' }),
      jsonResult('c2', 'edit', { ok: true, output: 'edit: applied' }),
    ];

    const out = compactMessages(messages, 10);

    expect(resultValue(out[1])).toContain(RUNNER_COMPACTED_MARKER);
    // The short edit result is below the floor and is kept verbatim.
    expect(resultValue(out[3])).toBe(JSON.stringify({ ok: true, output: 'edit: applied' }));
  });

  it('should keep a large read that is never superseded', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/only.ts' }),
      textResult('c1', 'read', big('ONLY')),
    ];

    expect(compactMessages(messages, 10)[1]).toBe(messages[1]);
  });

  it('should not elide results below the floor size', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', 'small-1'),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', 'small-2'),
    ];

    expect(compactMessages(messages, 10)).toEqual(messages);
  });

  it('should keep only the most-recent window of distinct large reads', () => {
    const reads = ['a', 'b', 'c', 'd'].flatMap((name, i): ModelMessage[] => [
      call(`c${i}`, 'read', { path: `src/${name}.ts` }),
      textResult(`c${i}`, 'read', big(name)),
    ]);

    const out = compactMessages(reads, 2);

    // 4 distinct, none superseded → window=2 keeps the last 2 (c/d), elides a/b.
    expect(resultValue(out[1])).toContain(RUNNER_COMPACTED_MARKER); // a
    expect(resultValue(out[3])).toContain(RUNNER_COMPACTED_MARKER); // b
    expect(resultValue(out[5])).toBe(big('c'));
    expect(resultValue(out[7])).toBe(big('d'));
  });

  it('should disable compaction when the window is zero', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', big('A')),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', big('A2')),
    ];

    expect(compactMessages(messages, 0)).toEqual(messages);
  });

  it('should not mutate the input messages', () => {
    const original = big('A');
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', original),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', big('A2')),
    ];

    compactMessages(messages, 10);

    expect(resultValue(messages[1])).toBe(original);
  });

  it('should preserve message count and tool-call/result pairing', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', big('A')),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', big('A2')),
    ];

    const out = compactMessages(messages, 10);

    expect(out).toHaveLength(messages.length);
    const ids = out.flatMap((m: ModelMessage): string[] =>
      Array.isArray(m.content)
        ? (m.content as ReadonlyArray<Record<string, unknown>>).map((p): string => String(p.toolCallId))
        : []
    );
    expect(ids).toEqual(['c1', 'c1', 'c2', 'c2']);
  });

  it('should include the elided character count in the marker', () => {
    const messages: ModelMessage[] = [
      call('c1', 'read', { path: 'src/a.ts' }),
      textResult('c1', 'read', big('A')),
      call('c2', 'read', { path: 'src/a.ts' }),
      textResult('c2', 'read', big('A2')),
    ];

    const out = compactMessages(messages, 10);

    expect(resultValue(out[1])).toMatch(/\d+ chars/);
  });
});

describe('resolveCompactionWindow', () => {
  const ENV_KEY = 'RUNNER_COMPACTION_WINDOW';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  });

  it('should return the default when the env var is unset', () => {
    expect(resolveCompactionWindow()).toBe(DEFAULT_COMPACTION_WINDOW);
  });

  it('should default to 10', () => {
    expect(DEFAULT_COMPACTION_WINDOW).toBe(10);
  });

  it('should honor a numeric env override', () => {
    process.env[ENV_KEY] = '4';

    expect(resolveCompactionWindow()).toBe(4);
  });

  it('should fall back to the default when the env var is non-numeric', () => {
    process.env[ENV_KEY] = 'not-a-number';

    expect(resolveCompactionWindow()).toBe(DEFAULT_COMPACTION_WINDOW);
  });
});
