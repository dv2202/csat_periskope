import { describe, it, expect } from 'vitest';
import { fastPath } from '@/lib/parser/fastPath';
import { rulesFallback } from '@/lib/parser/fallback';
import { needsReview } from '@/lib/parser';
import { parserOutputSchema } from '@/lib/parser/schema';

describe('fastPath', () => {
  it('scores a bare number', () => {
    expect(fastPath('5')?.score).toBe(5);
    expect(fastPath(' 1 ')?.score).toBe(1);
  });
  it('scores stars', () => {
    expect(fastPath('⭐⭐⭐⭐')?.score).toBe(4);
  });
  it('scores thumbs', () => {
    expect(fastPath('👍')?.score).toBe(4);
    expect(fastPath('👎')?.score).toBe(2);
  });
  it('maps score to sentiment', () => {
    expect(fastPath('5')?.sentiment).toBe('positive');
    expect(fastPath('3')?.sentiment).toBe('neutral');
    expect(fastPath('1')?.sentiment).toBe('negative');
  });
  it('returns null for free text (falls through to LLM)', () => {
    expect(fastPath('great service thanks')).toBeNull();
    expect(fastPath('6')).toBeNull();
    expect(fastPath('')).toBeNull();
  });
  it('fast output passes the zod schema', () => {
    expect(parserOutputSchema.safeParse(fastPath('4')).success).toBe(true);
  });
});

describe('rulesFallback', () => {
  it('reads an explicit digit', () => {
    expect(rulesFallback('maybe a 2 for effort').score).toBe(2);
  });
  it('infers positive sentiment (multilingual)', () => {
    expect(rulesFallback('bahut badhiya thanks').sentiment).toBe('positive');
    expect(rulesFallback('ótimo atendimento').sentiment).toBe('positive');
  });
  it('infers negative sentiment', () => {
    expect(rulesFallback('bekar service, very slow').sentiment).toBe('negative');
  });
  it('is low confidence by design', () => {
    expect(rulesFallback('great').confidence).toBeLessThan(0.6);
  });
  it('output passes the zod schema', () => {
    expect(parserOutputSchema.safeParse(rulesFallback('terrible')).success).toBe(true);
  });
});

describe('needsReview', () => {
  const base = {
    is_csat_response: true as const,
    score: 4 as const,
    confidence: 0.9,
    sentiment: 'positive' as const,
    reason_summary: 'x',
    themes: [],
    new_issue: { present: false, summary: null },
    language: 'en',
  };
  it('does not flag a confident score', () => {
    expect(needsReview(base, 0.6)).toBe(false);
  });
  it('flags a low-confidence score', () => {
    expect(needsReview({ ...base, confidence: 0.4 }, 0.6)).toBe(true);
  });
  it('flags a missing score', () => {
    expect(needsReview({ ...base, score: null }, 0.6)).toBe(true);
  });
  it('does not flag a non-csat reply (handled separately)', () => {
    expect(needsReview({ ...base, is_csat_response: false, score: null }, 0.6)).toBe(false);
  });
});
