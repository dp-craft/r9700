# Task: countWords

Implement a pure function `countWords(text: string): ReadonlyMap<string, number>` that
splits `text` on whitespace, normalizes each token with the EXISTING `normalizeToken`
utility from `lib/tokenize`, drops empty tokens, and returns a map of token -> occurrence count.

Output exactly two fenced code blocks, each preceded by a filename marker line:
`// FILE: impl.ts` then the implementation, and `// FILE: impl.test.ts` then vitest tests.
The implementation MUST `import { normalizeToken } from "../../lib/tokenize"` and reuse it.
