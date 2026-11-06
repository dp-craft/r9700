# logfmt

Create `src/logfmt.ts`. It exports `parse`, `format` and the class `LogfmtError`.

## LogfmtError
`class LogfmtError extends Error` with a public numeric property `column`, set by its constructor `(message: string, column: number)`.

## parse(line: string): Record<string, string | true>
A line holds zero or more pairs separated by one or more spaces or tabs.
- `key` with no `=` gives the value `true`.
- `key=` gives the empty string.
- `key=value` with a bare value: the value runs until the next space or tab. It may contain `=`.
- `key="value"` with a quoted value: the escapes `\"`, `\\` and `\n` are decoded.
- If a key repeats, the last one wins.
- Keys keep their first-seen insertion order in the result.
- An empty or all-whitespace line gives `{}`.

Throw `LogfmtError` with `column` set to the 0-based index in the line of the offending character:
- A pair starting with `=` (empty key): the `=`.
- An unterminated quote: the opening `"`.
- An unknown escape such as `\t`: the backslash.
- A non-whitespace character right after a closing quote: that character.

## format(fields: Record<string, string | true>): string
Joins pairs with one space, in insertion order.
- `true` gives the bare key.
- A value is quoted if it is empty or contains a space, tab, `"`, `\`, `=` or newline. In a quoted value, encode `"` as `\"`, `\` as `\\` and newline as `\n`.
- Other values are written bare.
- A key that is empty or contains a space, tab, `=` or `"` throws `LogfmtError` with `column` -1.

`parse(format(x))` must equal `x` for any valid `x`. A tab inside a quoted value is written and read back as it is.
