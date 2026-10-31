// PROBE-ONLY stub: the real screen.ts contract from W2-01b (brief lines 112-113).
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
