// PROBE-ONLY: the PATTERN block of the fixed W2-08 brief — W2-01b L39-43 verbatim
// (the Screen contract every screen copies). Diffed against the source, not re-derived.
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> } // undefined = EOF
export const runScreen: <S, R>(screen: Screen<S, R>, io: LineIO, prompt?: string) => Promise<R | undefined>; // EOF → undefined
export const lineIO: (input: NodeJS.ReadableStream, output: NodeJS.WritableStream) => LineIO; // node:readline async iterator (02-contracts.md C7)
