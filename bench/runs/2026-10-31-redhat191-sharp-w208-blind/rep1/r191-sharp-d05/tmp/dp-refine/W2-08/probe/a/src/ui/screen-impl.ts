// PROBE-ONLY: W2-08 PATTERN TO COPY block, the runScreen implementation.
import { type Screen, type LineIO } from './screen.js';

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
