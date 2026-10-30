import { spawn, type ChildProcess } from 'node:child_process';

export type ExternalSpawn = (command: string, args: readonly string[], opts: { stdio: 'inherit' }) => ChildProcess;
export interface ExternalDeps { readonly spawn: ExternalSpawn; readonly write: (line: string) => void }
const DEFAULT_DEPS: ExternalDeps = { spawn: spawn, write: (line) => console.log(line) };
const OPENERS: Partial<Record<NodeJS.Platform, string>> = { linux: 'xdg-open', darwin: 'open' };

const wait = (child: ChildProcess) =>
  new Promise<void>(resolve => {
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });

const makeOpenInEditor = (deps: ExternalDeps) =>
  (path: string, env: NodeJS.ProcessEnv, tty: boolean): Promise<void> =>
    (async () => {
      if (!tty) { deps.write(path); return; }
      const [command, ...args] = (env.VISUAL ?? env.EDITOR ?? 'vi').split(' ');
      const child = deps.spawn(command, [...args, path], { stdio: 'inherit' });
      child.on('error', () => deps.write(`could not start ${command}`));
      await wait(child);
    })();

const makePage = (deps: ExternalDeps) =>
  (path: string, env: NodeJS.ProcessEnv, tty: boolean): Promise<void> =>
    (async () => {
      if (!tty) { deps.write(path); return; }
      const [command, ...args] = (env.PAGER ?? 'less -R').split(' ');
      const child = deps.spawn(command, [...args, path], { stdio: 'inherit' });
      child.on('error', () => deps.write(`could not start ${command}`));
      await wait(child);
    })();

const makeOpenFiles = (deps: ExternalDeps) =>
  (paths: readonly string[], platform: NodeJS.Platform, tty: boolean): Promise<void> =>
    (async () => {
      const opener = OPENERS[platform];
      if (!tty || opener === undefined) { paths.forEach(p => deps.write(p)); return; }
      await Promise.all(paths.map(async p => {
        const child = deps.spawn(opener, [p], { stdio: 'inherit' });
        child.on('error', () => deps.write(`could not start ${opener}`));
        await wait(child);
      }));
    })();

export const externalTools = (deps: ExternalDeps) => ({ openInEditor: makeOpenInEditor(deps), page: makePage(deps), openFiles: makeOpenFiles(deps) });
export const { openInEditor, page, openFiles } = externalTools(DEFAULT_DEPS);
