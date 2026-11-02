// PROBE-ONLY — W2-01b's screen.ts code verbatim (briefs/W2-01b.md D9); post-W2-01b site
import { createInterface } from 'node:readline';

export interface Turn<S, R> { readonly state: S; readonly out: readonly string[]; readonly result?: R }
export interface Screen<S, R> { readonly start: Turn<S, R>; readonly next: (state: S, line: string) => Turn<S, R> }
export interface LineIO { readonly write: (text: string) => void; readonly ask: (prompt: string) => Promise<string | undefined> } // undefined = EOF

const DEFAULT_PROMPT = '> ';

interface Session<S, R> { readonly screen: Screen<S, R>; readonly io: LineIO; readonly prompt: string }

const writeAll = (io: LineIO, lines: readonly string[]): void => {
  lines.forEach(line => {
    io.write(line);
  });
};

/** One asked line → one turn; a turn's `out` is written before its result returns. */
const step = async <S, R>(session: Session<S, R>, turn: Turn<S, R>): Promise<R | undefined> => {
  const line = await session.io.ask(session.prompt);
  if (line === undefined) return undefined;
  const next = session.screen.next(turn.state, line);
  writeAll(session.io, next.out);
  return next.result === undefined ? step(session, next) : next.result;
};

export const runScreen = <S, R>(screen: Screen<S, R>, io: LineIO, prompt = DEFAULT_PROMPT): Promise<R | undefined> => {
  writeAll(io, screen.start.out);
  return step({ screen, io, prompt }, screen.start);
};

export const lineIO = (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): LineIO => {
  const lines = createInterface({ input, terminal: false })[Symbol.asyncIterator]();
  return {
    write: text => {
      output.write(`${text}\n`);
    },
    ask: async prompt => {
      output.write(prompt);
      const next = await lines.next();
      return next.done === true ? undefined : next.value;
    },
  };
};
