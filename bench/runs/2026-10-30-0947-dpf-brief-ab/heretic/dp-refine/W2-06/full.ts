import { spawn, type ChildProcess } from 'node:child_process';

export type ExternalSpawn = (command: string, args: readonly string[], opts: { stdio: 'inherit' }) => ChildProcess;
export interface ExternalDeps { readonly spawn: ExternalSpawn; readonly write: (line: string) => void }
const DEFAULT_DEPS: ExternalDeps = { spawn: spawn, write: (line) => console.log(line) };

export const openInEditor = (path: string, env: NodeJS.ProcessEnv, tty: boolean, deps?: ExternalDeps): Promise<void> => {
  const d = deps ?? DEFAULT_DEPS;
  if (tty === false) {
    d.write(path);
    return Promise.resolve();
  }
  const editor = env.VISUAL ?? env.EDITOR ?? 'vi';
  const child = d.spawn(editor, [path], { stdio: 'inherit' });
  return new Promise(resolve => child.on('close', resolve));
};

export const page = (path: string, env: NodeJS.ProcessEnv, tty: boolean, deps?: ExternalDeps): Promise<void> => {
  const d = deps ?? DEFAULT_DEPS;
  if (tty === false) {
    d.write(path);
    return Promise.resolve();
  }
  const pager = env.PAGER ?? 'less -R';
  const parts = pager.split(' ');
  const child = d.spawn(parts[0], [...parts.slice(1), path], { stdio: 'inherit' });
  return new Promise(resolve => child.on('close', resolve));
};

export const openFiles = (paths: readonly string[], platform: NodeJS.Platform, tty: boolean, deps?: ExternalDeps): Promise<void> => {
  const d = deps ?? DEFAULT_DEPS;
  if (tty === false) {
    paths.forEach((p) => { d.write(p); });
    return Promise.resolve();
  }
  const opener = platform === 'linux' ? 'xdg-open' : platform === 'darwin' ? 'open' : null;
  if (opener === null) {
    paths.forEach((p) => { d.write(p); });
    return Promise.resolve();
  }
  const children = paths.map((p) => d.spawn(opener, [p], { stdio: 'inherit' }));
  return Promise.all(children.map((c) => new Promise<void>((resolve) => c.on('close', resolve)))).then(() => undefined);
};

// fakeDeps helper (test side)
const fakeDeps = () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const written: string[] = [];
  const deps: ExternalDeps = {
    spawn: (command, args) => {
      calls.push({ command, args });
      return { on: (event: string, cb: () => void) => { if (event === 'close') cb(); } } as ChildProcess;
    },
    write: (line) => { written.push(line); },
  };
  return { calls, written, deps };
};
