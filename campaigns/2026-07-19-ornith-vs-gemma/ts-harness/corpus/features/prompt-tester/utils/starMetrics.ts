import type { StarRow } from '../types';
import { buildRunAnalysis } from './buildRunAnalysis';
import { classifyPerplexity } from './perplexityQuality';

const fluencyStars = (perplexity: number): number => {
  const band = classifyPerplexity(perplexity);
  return band === 'good' ? 5 : band === 'average' ? 3 : 1;
};

const readabilityStars = (grade: number): number =>
  grade <= 6 ? 5 : grade <= 9 ? 4 : grade <= 12 ? 3 : grade <= 15 ? 2 : 1;

const vocabularyStars = (diversity: number): number =>
  diversity >= 0.75 ? 5 : diversity >= 0.6 ? 4 : diversity >= 0.45 ? 3 : diversity >= 0.3 ? 2 : 1;

export const buildQualityStarRows = (output: string): readonly StarRow[] => {
  if (output.trim() === '') return [];
  const analysis = buildRunAnalysis(output);
  const rows: readonly StarRow[] = [
    { category: 'fluency', score: fluencyStars(analysis.perplexity) },
    { category: 'readability', score: readabilityStars(analysis.readabilityGrade) },
    { category: 'vocabulary', score: vocabularyStars(analysis.lexicalDiversity) },
  ];
  return [...rows].sort((x, y) => y.score - x.score);
};

export const meanQualityStars = (output: string): number => {
  const rows = buildQualityStarRows(output);
  return rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
};
