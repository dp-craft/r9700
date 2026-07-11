import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolResult } from '../shared/types';
import {
  DEFAULT_MAX_TOOL_OUTPUT_CHARS,
  resolveMaxToolOutputChars,
  truncateResult,
  truncateToolOutput
} from './truncate';

describe('truncateToolOutput', () => {
  it('should return the output unchanged when it is under the cap', () => {
    const output = 'short output';

    expect(truncateToolOutput(output, 100)).toBe(output);
  });

  it('should return the output unchanged when it is exactly at the cap', () => {
    const output = 'x'.repeat(50);

    expect(truncateToolOutput(output, 50)).toBe(output);
  });

  it('should bound the length when the output exceeds the cap', () => {
    const output = 'a'.repeat(10000);
    const max = 100;

    const result = truncateToolOutput(output, max);

    expect(result.length).toBeLessThan(output.length);
    expect(result.length).toBeLessThanOrEqual(max + 64);
  });

  it('should include a truncation marker with the dropped count when over the cap', () => {
    const output = 'b'.repeat(10000);

    const result = truncateToolOutput(output, 100);

    expect(result).toContain('truncated');
    expect(result).toMatch(/truncated \d+ chars/);
  });

  it('should preserve the head and the tail of the original output', () => {
    const output = `HEAD_MARKER${'.'.repeat(10000)}TAIL_MARKER`;

    const result = truncateToolOutput(output, 200);

    expect(result.startsWith('HEAD_MARKER')).toBe(true);
    expect(result.endsWith('TAIL_MARKER')).toBe(true);
  });

  it('should report the correct dropped count in the marker', () => {
    const output = 'c'.repeat(1000);
    const max = 100;

    const result = truncateToolOutput(output, max);
    const match = result.match(/truncated (\d+) chars/);
    const dropped = Number(match?.[1]);

    expect(dropped).toBe(output.length - max);
  });
});

describe('truncateResult', () => {
  it('should leave a small result output untouched and preserve ok', () => {
    const result: ToolResult = { ok: true, output: 'tiny' };

    expect(truncateResult(result, 100)).toEqual(result);
  });

  it('should truncate a large result output while preserving ok', () => {
    const result: ToolResult = { ok: false, output: 'z'.repeat(10000) };

    const truncated = truncateResult(result, 100);

    expect(truncated.ok).toBe(false);
    expect(truncated.output.length).toBeLessThan(result.output.length);
    expect(truncated.output).toContain('truncated');
  });
});

describe('resolveMaxToolOutputChars', () => {
  const ENV_KEY = 'RUNNER_MAX_TOOL_OUTPUT_CHARS';
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
    expect(resolveMaxToolOutputChars()).toBe(DEFAULT_MAX_TOOL_OUTPUT_CHARS);
  });

  it('should default to 128000', () => {
    expect(DEFAULT_MAX_TOOL_OUTPUT_CHARS).toBe(128000);
  });

  it('should honor a numeric env override', () => {
    process.env[ENV_KEY] = '500';

    expect(resolveMaxToolOutputChars()).toBe(500);
  });

  it('should fall back to the default when the env var is non-numeric', () => {
    process.env[ENV_KEY] = 'not-a-number';

    expect(resolveMaxToolOutputChars()).toBe(DEFAULT_MAX_TOOL_OUTPUT_CHARS);
  });
});
