import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AttemptPacket, PacketFile, ReviewPacket } from './grade-schema';

interface RunJson {
  readonly modelId?: string;
  readonly mode?: string;
  readonly status?: string;
}

interface MetaJson {
  readonly attempt?: number;
  readonly furthestStage?: string;
  readonly failedStage?: string;
  readonly gateName?: string;
  readonly toolCalls?: number;
}

const readJson = async <T>(path: string): Promise<T | undefined> => {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const readText = async (path: string): Promise<string> =>
  readFile(path, 'utf8').catch(() => '');

const listDirs = async (path: string): Promise<readonly string[]> => {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter(e => e.isDirectory()).map(e => e.name);
};

const readFiles = async (filesDir: string): Promise<readonly PacketFile[]> => {
  const entries = await readdir(filesDir, { withFileTypes: true }).catch(() => []);
  const names = entries.filter(e => e.isFile()).map(e => e.name);
  return Promise.all(
    names.map(async (basename): Promise<PacketFile> => ({
      basename,
      content: await readText(join(filesDir, basename)),
    }))
  );
};

const readAttempt = async (
  runDir: string,
  attemptDir: string
): Promise<AttemptPacket | undefined> => {
  const base = join(runDir, attemptDir);
  const meta = await readJson<MetaJson>(join(base, 'meta.json'));
  if (meta === undefined) return undefined;
  return {
    attempt: meta.attempt ?? 0,
    furthestStage: meta.furthestStage ?? '',
    failedStage: meta.failedStage ?? '',
    gateName: meta.gateName ?? '',
    toolCalls: meta.toolCalls ?? 0,
    gateOutput: await readText(join(base, 'gate-output.txt')),
    files: await readFiles(join(base, 'files')),
  };
};

const readAttempts = async (runDir: string): Promise<readonly AttemptPacket[]> => {
  const dirs = (await listDirs(runDir))
    .filter(d => d.startsWith('attempt-'))
    .sort();
  const packets = await Promise.all(dirs.map(d => readAttempt(runDir, d)));
  return packets.filter((p): p is AttemptPacket => p !== undefined);
};

const readRun = async (root: string, runId: string): Promise<ReviewPacket | undefined> => {
  const runDir = join(root, runId);
  const run = await readJson<RunJson>(join(runDir, 'run.json'));
  if (run === undefined) return undefined;
  return {
    runId,
    modelId: run.modelId ?? '',
    mode: run.mode ?? '',
    status: run.status ?? '',
    attempts: await readAttempts(runDir),
  };
};

export const collectPackets = async (rootDir: string): Promise<readonly ReviewPacket[]> => {
  const runIds = await listDirs(rootDir);
  const packets = await Promise.all(runIds.map(id => readRun(rootDir, id)));
  return packets.filter((p): p is ReviewPacket => p !== undefined);
};
