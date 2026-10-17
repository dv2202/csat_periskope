import type { ParserOutput } from './schema';

/**
 * Deterministic fast path: no LLM call for the overwhelmingly common replies
 * (a bare number, a star count, a thumb). Saves cost and latency and is 100%
 * accurate for these shapes. Everything else falls through to the LLM.
 */
export function fastPath(reply: string): ParserOutput | null {
  const t = reply.trim();
  if (!t) return null;

  // Bare 1-5
  if (/^[1-5]$/.test(t)) {
    return scoreOutput(Number(t) as 1 | 2 | 3 | 4 | 5, 'fast-path: numeric rating');
  }

  // Star ratings: count ⭐ / ★ when the message is only stars.
  const stars = (t.match(/[⭐★☆]/g) ?? []).length;
  if (stars >= 1 && stars <= 5 && /^[⭐★☆\s]+$/.test(t)) {
    return scoreOutput(stars as 1 | 2 | 3 | 4 | 5, 'fast-path: star rating');
  }

  // Thumbs (only when the message is essentially just the emoji)
  if (/^[\u{1F44D}]+$/u.test(t)) return scoreOutput(4, 'fast-path: thumbs up');
  if (/^[\u{1F44E}]+$/u.test(t)) return scoreOutput(2, 'fast-path: thumbs down');

  return null;
}

function scoreOutput(score: 1 | 2 | 3 | 4 | 5, reason: string): ParserOutput {
  const sentiment = score >= 4 ? 'positive' : score === 3 ? 'neutral' : 'negative';
  return {
    is_csat_response: true,
    score,
    confidence: 1,
    sentiment,
    reason_summary: reason,
    themes: [],
    new_issue: { present: false, summary: null },
    language: 'und',
  };
}
