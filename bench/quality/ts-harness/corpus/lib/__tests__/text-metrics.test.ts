import { describe, expect, it } from 'vitest';

import type { Tier2MetricsDTO } from '@/db/idb';
import {
  computeAvgSentenceLength,
  computeBleu,
  computeHedgingDensity,
  computeJaccardSimilarity,
  computeKeywordPresence,
  computeLexicalDiversity,
  computePassiveVoiceRatio,
  computePerplexityEstimate,
  computeQuestionDensity,
  computeReadabilityGrade,
  computeReadingTimeMinutes,
  computeRepetitionScore,
  computeRouge1,
  computeRouge2,
  computeSentenceCount,
  computeSentiment,
  computeTier2Metrics,
  computeWordCount
} from '@/lib/text-metrics';

// -- computeLexicalDiversity --

describe('computeLexicalDiversity', () => {
  // -- Positive paths --

  it('should return 1.0 when all words are unique', () => {
    const result = computeLexicalDiversity('the quick brown fox');

    expect(result).toBe(1.0);
  });

  it('should return value less than 1.0 when text has repeated words', () => {
    const result = computeLexicalDiversity('the the the cat');

    expect(result).toBeCloseTo(0.5, 5);
  });

  it('should be case-insensitive when computing uniqueness', () => {
    const result = computeLexicalDiversity('Hello hello HELLO');

    expect(result).toBeCloseTo(1 / 3, 5);
  });

  // -- Edge cases --

  it('should return 0 when text is empty', () => {
    const result = computeLexicalDiversity('');

    expect(result).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    const result = computeLexicalDiversity('   ');

    expect(result).toBe(0);
  });

  it('should return 1.0 when text has a single word', () => {
    const result = computeLexicalDiversity('hello');

    expect(result).toBe(1.0);
  });

  it('should handle text with multiple spaces between words', () => {
    const result = computeLexicalDiversity('hello   world');

    expect(result).toBe(1.0);
  });
});

// -- computeRepetitionScore --

describe('computeRepetitionScore', () => {
  // -- Positive paths --

  it('should return 0 when text has no repeated n-grams', () => {
    const result = computeRepetitionScore('the quick brown fox jumps over a lazy dog');

    expect(result).toBe(0);
  });

  it('should return value greater than 0 when text has repeated phrases', () => {
    const result = computeRepetitionScore('the cat sat the cat sat the cat sat on the mat');

    expect(result).toBeGreaterThan(0);
  });

  it('should return higher score for more repetitive text', () => {
    const lessRepetitive = computeRepetitionScore('the cat sat on a mat near the dog');
    const moreRepetitive = computeRepetitionScore('the cat the cat the cat the cat the cat');

    expect(moreRepetitive).toBeGreaterThan(lessRepetitive);
  });

  // -- Edge cases --

  it('should return 0 when text is empty', () => {
    const result = computeRepetitionScore('');

    expect(result).toBe(0);
  });

  it('should return 0 when text has fewer than 3 words', () => {
    const result = computeRepetitionScore('hello world');

    expect(result).toBe(0);
  });

  it('should return value in range 0 to 1', () => {
    const result = computeRepetitionScore('this is a test this is a test this is a test');

    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// -- computeReadabilityGrade --

describe('computeReadabilityGrade', () => {
  // -- Positive paths --

  it('should return a positive grade for normal English text', () => {
    const result = computeReadabilityGrade('The cat sat on the mat. The dog ran in the park.');

    expect(result).toBeGreaterThan(0);
  });

  it('should return higher grade for complex sentences with longer words', () => {
    const simple = computeReadabilityGrade('The cat sat. The dog ran.');
    const complex = computeReadabilityGrade(
      'The implementation of sophisticated algorithms necessitates comprehensive understanding of computational complexity.'
    );

    expect(complex).toBeGreaterThan(simple);
  });

  it('should return a finite number for typical prose', () => {
    const result = computeReadabilityGrade(
      'Reading is important for education. Students should practice every day. Books open new worlds.'
    );

    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  // -- Edge cases --

  it('should return 0 when text is empty', () => {
    const result = computeReadabilityGrade('');

    expect(result).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    const result = computeReadabilityGrade('   ');

    expect(result).toBe(0);
  });

  it('should handle text with no sentence-ending punctuation', () => {
    const result = computeReadabilityGrade('the quick brown fox jumps over the lazy dog');

    expect(result).toBeGreaterThan(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('should handle single-word text', () => {
    const result = computeReadabilityGrade('hello');

    expect(Number.isFinite(result)).toBe(true);
  });
});

// -- computeRouge1 --

describe('computeRouge1', () => {
  // -- Positive paths --

  it('should return 1.0 when response and reference are identical', () => {
    const result = computeRouge1('the cat sat on the mat', 'the cat sat on the mat');

    expect(result).toBe(1.0);
  });

  it('should return partial score when texts partially overlap', () => {
    const result = computeRouge1('the cat sat on the mat', 'the cat chased the dog');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  // -- Negative cases --

  it('should return 0 when response and reference share no words', () => {
    const result = computeRouge1('hello world', 'foo bar baz');

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should return 0 when reference is empty', () => {
    const result = computeRouge1('some text', '');

    expect(result).toBe(0);
  });

  it('should return 0 when response is empty', () => {
    const result = computeRouge1('', 'some text');

    expect(result).toBe(0);
  });

  it('should be case-insensitive', () => {
    const result = computeRouge1('The Cat', 'the cat');

    expect(result).toBe(1.0);
  });

  it('should compute recall relative to reference length', () => {
    // Reference has 3 unique words: "the", "cat", "sat"
    // Response contains 2 of them: "the", "cat"
    const result = computeRouge1('the cat ran', 'the cat sat');

    // recall = 2 matching reference unigrams / 3 reference unigrams
    expect(result).toBeCloseTo(2 / 3, 5);
  });
});

// -- computeRouge2 --

describe('computeRouge2', () => {
  // -- Positive paths --

  it('should return 1.0 when response and reference are identical', () => {
    const result = computeRouge2('the cat sat on the mat', 'the cat sat on the mat');

    expect(result).toBe(1.0);
  });

  it('should return partial score when some bigrams match', () => {
    const result = computeRouge2('the cat sat on a mat', 'the cat chased the dog around');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  // -- Negative cases --

  it('should return 0 when texts share no bigrams', () => {
    const result = computeRouge2('hello world today', 'foo bar baz');

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should return 0 when reference is empty', () => {
    const result = computeRouge2('some text here', '');

    expect(result).toBe(0);
  });

  it('should return 0 when reference has only one word', () => {
    const result = computeRouge2('the cat sat', 'hello');

    expect(result).toBe(0);
  });

  it('should return 0 when response has only one word', () => {
    const result = computeRouge2('hello', 'the cat sat');

    expect(result).toBe(0);
  });
});

// -- computeBleu --

describe('computeBleu', () => {
  // -- Positive paths --

  it('should return close to 1.0 when response and reference are identical', () => {
    const text = 'the cat sat on the mat in the room';
    const result = computeBleu(text, text);

    expect(result).toBeCloseTo(1.0, 1);
  });

  it('should return value between 0 and 1 for partially matching texts', () => {
    const result = computeBleu('the cat sat on the mat', 'the cat chased the dog around the park');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  // -- Negative cases --

  it('should return 0 when response and reference share no words', () => {
    const result = computeBleu('hello world today', 'foo bar baz qux');

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should apply brevity penalty when response is shorter than reference', () => {
    const shortResponse = 'the cat';
    const longReference = 'the cat sat on the mat in the big room near the window';

    const result = computeBleu(shortResponse, longReference);

    // With brevity penalty, score should be reduced
    expect(result).toBeLessThan(1.0);
  });

  it('should return 0 when response is empty', () => {
    const result = computeBleu('', 'some reference text');

    expect(result).toBe(0);
  });

  it('should return 0 when reference is empty', () => {
    const result = computeBleu('some text', '');

    expect(result).toBe(0);
  });
});

// -- computeKeywordPresence --

describe('computeKeywordPresence', () => {
  // -- Positive paths --

  it('should return 1.0 when all reference words are present in response', () => {
    const result = computeKeywordPresence('the quick brown fox jumps', 'the quick brown fox');

    expect(result).toBe(1.0);
  });

  it('should return partial score when some reference words are present', () => {
    const result = computeKeywordPresence('the cat ran', 'the cat sat on mat');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  // -- Negative cases --

  it('should return 0 when no reference words are present in response', () => {
    const result = computeKeywordPresence('hello world', 'foo bar baz');

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should return 0 when reference is empty', () => {
    const result = computeKeywordPresence('some text', '');

    expect(result).toBe(0);
  });

  it('should return 0 when response is empty', () => {
    const result = computeKeywordPresence('', 'some text');

    expect(result).toBe(0);
  });

  it('should be case-insensitive', () => {
    const result = computeKeywordPresence('THE CAT SAT', 'the cat sat');

    expect(result).toBe(1.0);
  });
});

// -- computeJaccardSimilarity --

describe('computeJaccardSimilarity', () => {
  // -- Positive paths --

  it('should return 1.0 when word sets are identical', () => {
    const result = computeJaccardSimilarity('the cat sat', 'the cat sat');

    expect(result).toBe(1.0);
  });

  it('should return value between 0 and 1 for partially overlapping sets', () => {
    const result = computeJaccardSimilarity('the cat sat', 'the dog sat');

    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  // -- Negative cases --

  it('should return 0 when word sets are completely disjoint', () => {
    const result = computeJaccardSimilarity('hello world', 'foo bar');

    expect(result).toBe(0);
  });

  // -- Edge cases --

  it('should return 0 when both texts are empty', () => {
    const result = computeJaccardSimilarity('', '');

    expect(result).toBe(0);
  });

  it('should return 0 when one text is empty', () => {
    const result = computeJaccardSimilarity('hello', '');

    expect(result).toBe(0);
  });

  it('should be case-insensitive', () => {
    const result = computeJaccardSimilarity('THE CAT', 'the cat');

    expect(result).toBe(1.0);
  });

  it('should compute intersection over union correctly', () => {
    // A = {the, cat, sat} (3 unique), B = {the, dog, sat} (3 unique)
    // intersection = {the, sat} = 2, union = {the, cat, sat, dog} = 4
    const result = computeJaccardSimilarity('the cat sat', 'the dog sat');

    expect(result).toBeCloseTo(2 / 4, 5);
  });
});

// -- computeWordCount --

describe('computeWordCount', () => {
  it('should count whitespace-separated words', () => {
    expect(computeWordCount('the quick brown fox')).toBe(4);
  });

  it('should ignore extra whitespace between words', () => {
    expect(computeWordCount('hello   world\n\ttab')).toBe(3);
  });

  it('should return 0 when text is empty', () => {
    expect(computeWordCount('')).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    expect(computeWordCount('   \n\t ')).toBe(0);
  });

  it('should count a single word', () => {
    expect(computeWordCount('hello')).toBe(1);
  });
});

// -- computeSentenceCount --

describe('computeSentenceCount', () => {
  it('should count sentences split by terminal punctuation', () => {
    expect(computeSentenceCount('One. Two! Three?')).toBe(3);
  });

  it('should count a single sentence without trailing punctuation', () => {
    expect(computeSentenceCount('just one sentence')).toBe(1);
  });

  it('should return 0 when text is empty', () => {
    expect(computeSentenceCount('')).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    expect(computeSentenceCount('   ')).toBe(0);
  });
});

// -- computeReadingTimeMinutes --

describe('computeReadingTimeMinutes', () => {
  it('should return word count divided by reading wpm', () => {
    const text = Array.from({ length: 238 }, () => 'word').join(' ');

    expect(computeReadingTimeMinutes(text)).toBeCloseTo(1, 5);
  });

  it('should scale with word count', () => {
    const text = Array.from({ length: 119 }, () => 'word').join(' ');

    expect(computeReadingTimeMinutes(text)).toBeCloseTo(0.5, 5);
  });

  it('should return 0 when text is empty', () => {
    expect(computeReadingTimeMinutes('')).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    expect(computeReadingTimeMinutes('   ')).toBe(0);
  });
});

// -- computePerplexityEstimate --

describe('computePerplexityEstimate', () => {
  it('should equal the vocabulary size when all words are distinct', () => {
    // 4 distinct words, uniform distribution -> H = log2(4) = 2 -> 2^H = 4
    expect(computePerplexityEstimate('the quick brown fox')).toBeCloseTo(4, 5);
  });

  it('should return 1 when all words are identical', () => {
    // single token, H = 0 -> 2^0 = 1
    expect(computePerplexityEstimate('cat cat cat cat')).toBeCloseTo(1, 5);
  });

  it('should be higher for more diverse text than repetitive text', () => {
    const diverse = computePerplexityEstimate('alpha beta gamma delta epsilon');
    const repetitive = computePerplexityEstimate('alpha alpha alpha alpha beta');

    expect(diverse).toBeGreaterThan(repetitive);
  });

  it('should return 0 when text is empty', () => {
    expect(computePerplexityEstimate('')).toBe(0);
  });

  it('should return 0 when text is only whitespace', () => {
    expect(computePerplexityEstimate('   ')).toBe(0);
  });
});

// -- computeTier2Metrics --

describe('computeTier2Metrics', () => {
  // -- Positive paths --

  it('should compute all metrics including reference metrics when referenceAnswer is provided', () => {
    const result = computeTier2Metrics(
      'The cat sat on the mat. The dog ran in the park.',
      'The cat sat near the mat.',
      0.3
    );

    expect(result.lexicalDiversity).toBeGreaterThan(0);
    expect(result.repetitionScore).toBeGreaterThanOrEqual(0);
    expect(result.readabilityGrade).toBeGreaterThan(0);
    expect(result.rouge1).not.toBeNull();
    expect(result.rouge2).not.toBeNull();
    expect(result.bleu).not.toBeNull();
    expect(result.keywordPresence).not.toBeNull();
    expect(result.jaccardSimilarity).not.toBeNull();
    expect(result.rouge1).toBeGreaterThanOrEqual(0);
    expect(result.rouge2).toBeGreaterThanOrEqual(0);
    expect(result.bleu).toBeGreaterThanOrEqual(0);
    expect(result.keywordPresence).toBeGreaterThanOrEqual(0);
    expect(result.jaccardSimilarity).toBeGreaterThanOrEqual(0);
  });

  // -- Negative cases --

  it('should return null for all reference-based metrics when referenceAnswer is null', () => {
    const result = computeTier2Metrics(
      'The cat sat on the mat. The dog ran in the park.',
      null,
      0.3
    );

    expect(result.rouge1).toBeNull();
    expect(result.rouge2).toBeNull();
    expect(result.bleu).toBeNull();
    expect(result.keywordPresence).toBeNull();
    expect(result.jaccardSimilarity).toBeNull();
  });

  it('should still compute non-reference metrics when referenceAnswer is null', () => {
    const result = computeTier2Metrics(
      'The cat sat on the mat. The dog ran in the park.',
      null,
      0.3
    );

    expect(result.lexicalDiversity).toBeGreaterThan(0);
    expect(result.repetitionScore).toBeGreaterThanOrEqual(0);
    expect(result.readabilityGrade).toBeGreaterThan(0);
  });

  // -- State transitions (readabilityApproximate flag) --

  it('should set readabilityApproximate to true when structureScore is greater than 0.5', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', null, 0.6);

    expect(result.readabilityApproximate).toBe(true);
  });

  it('should set readabilityApproximate to false when structureScore is 0.5', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', null, 0.5);

    expect(result.readabilityApproximate).toBe(false);
  });

  it('should set readabilityApproximate to false when structureScore is less than 0.5', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', null, 0.3);

    expect(result.readabilityApproximate).toBe(false);
  });

  it('should set readabilityApproximate to true when structureScore is 1.0', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', null, 1.0);

    expect(result.readabilityApproximate).toBe(true);
  });

  it('should set readabilityApproximate to false when structureScore is 0', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', null, 0);

    expect(result.readabilityApproximate).toBe(false);
  });

  // -- Return type shape --

  it('should return an object conforming to Tier2MetricsDTO shape', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', 'The cat sat.', 0.3);

    const expected: Tier2MetricsDTO = {
      lexicalDiversity: expect.any(Number) as number,
      repetitionScore: expect.any(Number) as number,
      readabilityGrade: expect.any(Number) as number,
      readabilityApproximate: expect.any(Boolean) as boolean,
      rouge1: expect.any(Number) as number,
      rouge2: expect.any(Number) as number,
      bleu: expect.any(Number) as number,
      keywordPresence: expect.any(Number) as number,
      jaccardSimilarity: expect.any(Number) as number,
      perplexity: null,
      sentiment: null,
      passiveVoiceRatio: null,
      questionDensity: null,
      avgSentenceLength: null,
      hedgingDensity: null,
      namedEntityCount: null,
    };

    expect(result).toEqual(expected);
  });

  it('should return all 7 further-measurement fields as null', () => {
    const result = computeTier2Metrics('The cat sat on the mat.', 'The cat sat.', 0.3);

    expect(result.perplexity).toBeNull();
    expect(result.sentiment).toBeNull();
    expect(result.passiveVoiceRatio).toBeNull();
    expect(result.questionDensity).toBeNull();
    expect(result.avgSentenceLength).toBeNull();
    expect(result.hedgingDensity).toBeNull();
    expect(result.namedEntityCount).toBeNull();
  });
});

// -- computeSentiment --

describe('computeSentiment', () => {
  it('should return a positive value for positive-lexicon words', () => {
    const result = computeSentiment('great wonderful excellent');

    expect(result).toBeGreaterThan(0);
  });

  it('should return a negative value for negative-lexicon words', () => {
    const result = computeSentiment('terrible awful horrible');

    expect(result).toBeLessThan(0);
  });

  it('should return 0 for empty input', () => {
    const result = computeSentiment('   ');

    expect(result).toBe(0);
  });
});

// -- computePassiveVoiceRatio --

describe('computePassiveVoiceRatio', () => {
  it('should detect passive-voice constructions', () => {
    const result = computePassiveVoiceRatio('The letter was written by John.');

    expect(result).toBeGreaterThan(0);
  });

  it('should return 0 for all-active text', () => {
    const result = computePassiveVoiceRatio('John writes the letter.');

    expect(result).toBe(0);
  });

  it('should return 0 for empty input', () => {
    const result = computePassiveVoiceRatio('   ');

    expect(result).toBe(0);
  });
});

// -- computeQuestionDensity --

describe('computeQuestionDensity', () => {
  it('should return ratio of question sentences to total sentences', () => {
    const result = computeQuestionDensity('This is fine. Is it really? Yes.');

    expect(result).toBeCloseTo(1 / 3);
  });

  it('should return 0 for empty input', () => {
    const result = computeQuestionDensity('   ');

    expect(result).toBe(0);
  });
});

// -- computeAvgSentenceLength --

describe('computeAvgSentenceLength', () => {
  it('should return word count divided by sentence count', () => {
    const result = computeAvgSentenceLength('One two three. Four five six.');

    expect(result).toBeCloseTo(3);
  });

  it('should return 0 for empty input', () => {
    const result = computeAvgSentenceLength('   ');

    expect(result).toBe(0);
  });
});

// -- computeHedgingDensity --

describe('computeHedgingDensity', () => {
  it('should count hedging terms per 100 words', () => {
    const result = computeHedgingDensity('This perhaps maybe could work.');

    expect(result).toBeGreaterThan(0);
  });

  it('should return 0 when no hedging terms are present', () => {
    const result = computeHedgingDensity('The cat sat on the mat.');

    expect(result).toBe(0);
  });

  it('should return 0 for empty input', () => {
    const result = computeHedgingDensity('   ');

    expect(result).toBe(0);
  });
});
