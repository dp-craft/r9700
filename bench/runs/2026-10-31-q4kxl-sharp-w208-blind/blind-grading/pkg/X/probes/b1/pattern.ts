// PROBE-ONLY header: brief W2-08 PATTERN TO COPY block (lines 27-39) verbatim below.
// PROBE-ONLY LineIO stub: the block references LineIO but does not define it (the real
// screen.ts does); the stub is W2-01b's LineIO (brief line 114) so the rest can typecheck.
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> }
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export const runScreen = async <S, R>(screen: Screen<S, R>, io: LineIO, prompt?: string): Promise<R | undefined> => {
  let turn = screen.start;
  for (const line of turn.out) io.write(line);
  for (;;) {
    const line = await io.ask(prompt);
    if (line === undefined) return undefined;
    turn = screen.next(turn.state, line);
    if (turn.result !== undefined) return turn.result;
    for (const line of turn.out) io.write(line);
  }
};
