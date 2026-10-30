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
