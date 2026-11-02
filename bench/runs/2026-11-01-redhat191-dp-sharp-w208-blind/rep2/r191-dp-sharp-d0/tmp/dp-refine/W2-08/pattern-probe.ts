import { type Screen } from '../ui/screen.js';
import { type LineIO } from '../ui/screen.js';
export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
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
void runScreen;
