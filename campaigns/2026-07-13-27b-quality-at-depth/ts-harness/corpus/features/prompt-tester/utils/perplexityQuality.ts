export type PerplexityBand = 'good' | 'average' | 'bad';

export const PERPLEXITY_GOOD_MAX = 30;
export const PERPLEXITY_AVERAGE_MAX = 80;

export const classifyPerplexity = (value: number): PerplexityBand =>
  value <= PERPLEXITY_GOOD_MAX ? 'good' : value <= PERPLEXITY_AVERAGE_MAX ? 'average' : 'bad';
