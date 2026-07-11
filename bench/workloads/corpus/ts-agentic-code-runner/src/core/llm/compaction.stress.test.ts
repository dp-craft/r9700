import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { COMPACTION_FLOOR_CHARS, compactMessages } from './compaction';

// Stress harness: reproduce the AI-SDK tool loop that motivated this change — each
// step appends one (assistant tool-call, tool-result) pair, and the whole growing
// transcript is what prepareStep sees. These tests assert compaction makes the
// SENT payload plateau (bounding the O(steps²) cost) AND never corrupts the
// tool-call/tool-result pairing the chat protocol requires.

const BIG = COMPACTION_FLOOR_CHARS + 4000; // a ~4.4k-char read result, like a real file read
const bigBody = (tag: string): string => `${tag}:${'x'.repeat(BIG)}`;

const readPair = (i: number, path: string, body: string): ModelMessage[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `r${i}`, toolName: 'read', input: { path } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: `r${i}`, toolName: 'read', output: { type: 'text', value: body } }] },
];

const editPair = (i: number, path: string): ModelMessage[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `e${i}`, toolName: 'edit', input: { path, anchor: 'a', replacement: 'b' } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: `e${i}`, toolName: 'edit', output: { type: 'json', value: { ok: true, output: 'edit: applied' } } }] },
];

// A realistic TDD drive: re-read the SAME target every step (heavy supersede) plus
// an occasional distinct helper read (exercises the sliding window).
const tddTranscript = (steps: number): ModelMessage[] => {
  const head: ModelMessage = { role: 'user', content: 'kickoff' };
  const body = Array.from({ length: steps }, (_unused, i): ModelMessage[] => [
    ...readPair(i, 'src/target.ts', bigBody(`target-step-${i}`)),
    ...(i % 5 === 0 ? readPair(i + 10000, `src/helper-${i}.ts`, bigBody(`helper-${i}`)) : editPair(i, 'src/target.ts')),
  ]).flat();
  return [head, ...body];
};

const isToolResult = (p: unknown): p is { type: string; toolCallId: string; output: { type: string; value?: unknown } } =>
  typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'tool-result';
const isToolCall = (p: unknown): p is { type: string; toolCallId: string } =>
  typeof p === 'object' && p !== null && (p as { type?: unknown }).type === 'tool-call';

const parts = (m: ModelMessage): readonly unknown[] => (Array.isArray(m.content) ? m.content : []);

const serializedChars = (messages: readonly ModelMessage[]): number =>
  messages.reduce((sum, m): number => sum + JSON.stringify(m).length, 0);

const isResultMessage = (m: ModelMessage): boolean => parts(m).some(isToolResult);

// The real cost the runner pays: the SDK resends the whole transcript at EVERY
// step. Sum the compacted size of every growing prefix (one per completed step) —
// this is O(steps²) raw, and what compaction is meant to bend down to ~O(steps).
const cumulativeResentChars = (transcript: readonly ModelMessage[], window: number): number =>
  transcript.reduce((sum, _m, idx): number => {
    const prefix = transcript.slice(0, idx + 1);
    return isResultMessage(transcript[idx])
      ? sum + serializedChars(compactMessages(prefix, window))
      : sum;
  }, 0);

const largeResultCount = (messages: readonly ModelMessage[]): number =>
  messages
    .flatMap((m): readonly unknown[] => parts(m))
    .filter(isToolResult)
    .filter((p): boolean => {
      const o = p.output;
      const len = o.type === 'text' ? String(o.value ?? '').length : JSON.stringify(o.value ?? null).length;
      return len > COMPACTION_FLOOR_CHARS;
    }).length;

const callIds = (messages: readonly ModelMessage[]): string[] =>
  messages.flatMap((m): string[] => parts(m).filter(isToolCall).map((p): string => p.toolCallId));
const resultIds = (messages: readonly ModelMessage[]): string[] =>
  messages.flatMap((m): string[] => parts(m).filter(isToolResult).map((p): string => p.toolCallId));

describe('compaction under a long tool loop (stress)', () => {
  it('should keep exactly one large result when the same file is re-read every step', () => {
    // 64 reads of ONE file → every read but the last is superseded.
    const transcript = Array.from({ length: 64 }, (_u, i): ModelMessage[] =>
      readPair(i, 'src/target.ts', bigBody(`v${i}`))
    ).flat();

    const out = compactMessages(transcript, 10);

    expect(largeResultCount(transcript)).toBe(64); // raw cost
    expect(largeResultCount(out)).toBe(1); // bounded to the freshest copy
  });

  it('should cap large results at the window for many distinct one-off reads', () => {
    const transcript = Array.from({ length: 50 }, (_u, i): ModelMessage[] =>
      readPair(i, `src/file-${i}.ts`, bigBody(`f${i}`))
    ).flat();

    expect(largeResultCount(compactMessages(transcript, 8))).toBe(8);
    expect(largeResultCount(compactMessages(transcript, 12))).toBe(12);
  });

  it('should cut the cumulative resent bytes of a full loop by a large factor', () => {
    const transcript = tddTranscript(64);
    const raw = cumulativeResentChars(transcript, 0); // window 0 = compaction disabled
    const compacted = cumulativeResentChars(transcript, 10);

    // The resent total stays quadratic in steps, but compaction shrinks its
    // CONSTANT by elding the big read payloads — a large net saving over the loop.
    expect(compacted).toBeLessThan(raw / 3);
  });

  it('should bound the big-payload count per request by the window at any loop depth', () => {
    // The cost the user observed is one request RESENDING every prior big read.
    // Compaction caps the big results in any single request at ~window, no matter
    // how deep the loop — while the raw request grows linearly with the step count.
    [16, 32, 64].forEach((steps): void => {
      const compactedBigs = largeResultCount(compactMessages(tddTranscript(steps), 10));
      expect(compactedBigs).toBeLessThanOrEqual(10);
    });

    // Raw growth for contrast: the deepest request carries dozens of big reads.
    expect(largeResultCount(tddTranscript(64))).toBeGreaterThan(60);
  });

  it('should preserve every tool-call/tool-result pairing at scale', () => {
    const transcript = tddTranscript(64);

    const out = compactMessages(transcript, 10);

    expect(out).toHaveLength(transcript.length);
    // Same call ids, same result ids, every result still paired to its call.
    expect(resultIds(out)).toEqual(resultIds(transcript));
    expect(callIds(out)).toEqual(callIds(transcript));
    expect(new Set(resultIds(out)).size).toBeGreaterThan(0);
    resultIds(out).forEach((id): void => {
      expect(callIds(out)).toContain(id);
    });
  });

  it('should be stable when re-applied to an already-compacted transcript', () => {
    const once = compactMessages(tddTranscript(40), 10);
    const twice = compactMessages(once, 10);

    // Re-compaction neither corrupts structure nor re-elides the retained window.
    expect(twice).toHaveLength(once.length);
    expect(largeResultCount(twice)).toBe(largeResultCount(once));
    expect(resultIds(twice)).toEqual(resultIds(once));
  });

  it('should retain the most recent results verbatim (freshest working set kept)', () => {
    const transcript = tddTranscript(40);
    const out = compactMessages(transcript, 10);

    // The final tool-result in the transcript is the newest — it must survive intact.
    const lastIdx = transcript.length - 1;
    expect(out[lastIdx]).toEqual(transcript[lastIdx]);
  });
});
