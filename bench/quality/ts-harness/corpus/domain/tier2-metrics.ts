export interface Tier2Metrics {
  readonly lexicalDiversity: number;
  readonly repetitionScore: number;
  readonly readabilityGrade: number;
  readonly readabilityApproximate: boolean;
  readonly rouge1: number | null;
  readonly rouge2: number | null;
  readonly bleu: number | null;
  readonly keywordPresence: number | null;
  readonly jaccardSimilarity: number | null;
  // Further-measurement fields: null when flag off / unconsented / not yet computed.
  // Populated by the phase-2 analysis pass, not the sync local computation.
  readonly perplexity: number | null;
  readonly sentiment: number | null;
  readonly passiveVoiceRatio: number | null;
  readonly questionDensity: number | null;
  readonly avgSentenceLength: number | null;
  readonly hedgingDensity: number | null;
  readonly namedEntityCount: number | null;
}
