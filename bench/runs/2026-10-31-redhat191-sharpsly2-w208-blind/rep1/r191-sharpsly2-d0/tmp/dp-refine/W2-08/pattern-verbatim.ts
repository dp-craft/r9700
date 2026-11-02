// PROBE-ONLY: W2-08 PATTERN TO COPY block verbatim (briefs/W2-08.md:27-39).
// LineIO stub (not part of the block; screen.ts defines it):
interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> }

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
