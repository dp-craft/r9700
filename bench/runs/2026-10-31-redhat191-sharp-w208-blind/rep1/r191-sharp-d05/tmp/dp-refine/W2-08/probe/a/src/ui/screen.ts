// PROBE-ONLY stub: mirrors C7 contract types for tools/dpf/src/ui/screen.ts (W2-01b).
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> }
