import { readFile } from 'node:fs/promises';

import { aggregateGrades, renderStatsMarkdown } from './aggregate-grades';
import { collectPackets } from './collect-packets';
import type { RunnerGrade } from './grade-schema';

const HELP = `runner-eval — capability grading harness

Usage:
  eval/cli --collect <rootDir>      Print ReviewPacket[] JSON (from logs/runner-eval) to stdout
  eval/cli --report <gradesJson>    Read RunnerGrade[] JSON, print the markdown stats report
  eval/cli --help                   Show this help

Exit codes:
  0  success
  2  bad input (missing/unknown flag, missing argument, unreadable/invalid grades JSON)
`;

const runCollect = async (rootDir: string): Promise<number> => {
  const packets = await collectPackets(rootDir);
  console.log(JSON.stringify(packets, null, 2));
  return 0;
};

const readGrades = async (path: string): Promise<readonly RunnerGrade[] | undefined> => {
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as readonly RunnerGrade[]) : undefined;
  } catch {
    return undefined;
  }
};

const runReport = async (path: string): Promise<number> => {
  const grades = await readGrades(path);
  if (grades === undefined) {
    console.error(`runner-eval: cannot read RunnerGrade[] from ${path}`);
    return 2;
  }
  console.log(renderStatsMarkdown(aggregateGrades(grades)));
  return 0;
};

export const main = async (argv: readonly string[]): Promise<number> => {
  const [flag, value] = argv;
  if (flag === '--help' || flag === undefined) {
    console.log(HELP);
    return flag === undefined ? 2 : 0;
  }
  if (flag === '--collect' && value !== undefined) return runCollect(value);
  if (flag === '--report' && value !== undefined) return runReport(value);
  console.error(`runner-eval: invalid usage\n${HELP}`);
  return 2;
};

const entryUrl = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : undefined;
if (entryUrl === import.meta.url) {
  void main(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  });
}
