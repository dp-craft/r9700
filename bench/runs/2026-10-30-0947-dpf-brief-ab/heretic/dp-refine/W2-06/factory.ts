import { spawn, type ChildProcess } from 'node:child_process';

export type ExternalSpawn = (command: string, args: readonly string[], opts: { stdio: 'inherit' }) => ChildProcess;
export interface ExternalDeps { readonly spawn: ExternalSpawn; readonly write: (line: string) => void }
export interface ExternalTools {
  readonly openInEditor: (path: string, env: NodeJS.ProcessEnv, tty: boolean) => Promise<void>;
  readonly page: (path: string, env: NodeJS.ProcessEnv, tty: boolean) => Promise<void>;
  readonly openFiles: (paths: readonly string[], platform: NodeJS.Platform, tty: boolean) => Promise<void>;
}
const DEFAULT_DEPS: ExternalDeps = { spawn: spawn, write: (line) => console.log(line) };

const OPENERS: Partial<Record<NodeJS.Platform, string>> = { linux: 'xdg-open', darwin: 'open' };

const settle = (child: ChildProcess, command: string, write: (line: string) => void): Promise<void> =>
  new Promise<void>((resolve) => {
    child.on('error', () => {
      write(`${command} failed to start`);
      resolve();
    });
    child.on('close', () => resolve());
  });

export const externalTools = (deps: ExternalDeps): ExternalTools => {
  const openInEditor = (path: string, env: NodeJS.ProcessEnv, tty: boolean): Promise<void> => {
    if (tty === false) {
      deps.write(path);
      return Promise.resolve();
    }
    const editor = env.VISUAL ?? env.EDITOR ?? 'vi';
    const parts = editor.split(' ');
    const child = deps.spawn(parts[0], [...parts.slice(1), path], { stdio: 'inherit' });
    return settle(child, parts[0], deps.write);
  };
  const page = (path: string, env: NodeJS.ProcessEnv, tty: boolean): Promise<void> => {
    if (tty === false) {
      deps.write(path);
      return Promise.resolve();
    }
    const pager = env.PAGER ?? 'less -R';
    const parts = pager.split(' ');
    const child = deps.spawn(parts[0], [...parts.slice(1), path], { stdio: 'inherit' });
    return settle(child, parts[0], deps.write);
  };
  const openFiles = (paths: readonly string[], platform: NodeJS.Platform, tty: boolean): Promise<void> => {
    if (tty === false) {
      paths.forEach((p) => { deps.write(p); });
      return Promise.resolve();
    }
    const opener = OPENERS[platform];
    if (opener === undefined) {
      paths.forEach((p) => { deps.write(p); });
      return Promise.resolve();
    }
    const children = paths.map((p) => deps.spawn(opener, [p], { stdio: 'inherit' }));
    return Promise.all(children.map((c) => settle(c, opener, deps.write))).then(() => undefined);
  };
  return { openInEditor, page, openFiles };
};
export const { openInEditor, page, openFiles } = externalTools(DEFAULT_DEPS);
