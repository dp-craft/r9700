import type { CapabilityStats, RunnerGrade } from './grade-schema';

const GREEN_STAGES: readonly string[] = ['green', 'done'];

const tally = (keys: readonly string[]): Readonly<Record<string, number>> =>
  keys.reduce<Record<string, number>>((acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }), {});

const faithfulTestFailed = (grade: RunnerGrade): boolean =>
  grade.bars.some(b => b.bar === 'faithfulTest' && b.verdict === 'fail');

const isFalseGreen = (grade: RunnerGrade): boolean =>
  GREEN_STAGES.includes(grade.furthestStage) && faithfulTestFailed(grade);

export const aggregateGrades = (grades: readonly RunnerGrade[]): CapabilityStats => {
  const mergeableCount = grades.filter(g => g.mergeable).length;
  return {
    total: grades.length,
    byFurthestStage: tally(grades.map(g => g.furthestStage)),
    byPrimaryGap: tally(grades.map(g => g.primaryGap)),
    byModel: tally(grades.map(g => g.modelId)),
    mergeableCount,
    mergeableRate: grades.length === 0 ? 0 : mergeableCount / grades.length,
    falseGreenRiskCount: grades.filter(isFalseGreen).length,
  };
};

const renderRows = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .map(([key, n]) => `| ${key} | ${n} |`)
    .join('\n');

const section = (title: string, header: string, counts: Readonly<Record<string, number>>): string =>
  `### ${title}\n\n| ${header} | count |\n|---|---|\n${renderRows(counts)}`;

export const renderStatsMarkdown = (stats: CapabilityStats): string =>
  [
    '## Runner Capability Stats',
    '',
    `- total: ${stats.total}`,
    `- mergeable: ${stats.mergeableCount} (${(stats.mergeableRate * 100).toFixed(1)}%)`,
    `- false-green risk: ${stats.falseGreenRiskCount}`,
    '',
    section('Furthest Stage', 'stage', stats.byFurthestStage),
    '',
    section('Primary Gap', 'gap', stats.byPrimaryGap),
    '',
    section('Model', 'model', stats.byModel),
  ].join('\n');
