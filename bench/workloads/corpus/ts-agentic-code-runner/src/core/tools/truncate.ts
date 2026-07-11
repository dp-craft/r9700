import type { ToolResult } from '../shared';
import { ENV } from '../shared';

// Aligned to the runtime default context of DEFAULT_OLLAMA_NUM_CTX = 65536 tokens: a
// single tool output may consume up to ~32k tokens (~128k chars at 4 chars/token, ~50%
// of the actual 65536-token window) before it is truncated. This lets whole source files
// (e.g. a 65k-char store) be read in one pass instead of dropping the middle, which
// previously hid the very code a model needed.
export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 128000;

const HEAD_RATIO = 0.6;

export const resolveMaxToolOutputChars = (): number => {
  const parsed = Number(process.env[ENV.MAX_TOOL_OUTPUT_CHARS] ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS);
  return Number.isNaN(parsed) ? DEFAULT_MAX_TOOL_OUTPUT_CHARS : parsed;
};

export const truncateToolOutput = (output: string, maxChars: number): string => {
  if (output.length <= maxChars) {
    return output;
  }
  const headLen = Math.floor(maxChars * HEAD_RATIO);
  const tailLen = maxChars - headLen;
  const dropped = output.length - maxChars;
  const marker = `\n…[truncated ${dropped} chars]…\n`;
  return `${output.slice(0, headLen)}${marker}${output.slice(output.length - tailLen)}`;
};

export const truncateResult = (result: ToolResult, maxChars: number): ToolResult => ({
  ...result,
  output: truncateToolOutput(result.output, maxChars),
});
