import type { ParserOutput } from './schema';

// Deterministic rules fallback, used only when the LLM path fails twice.
// Multilingual keyword lists (English / Hinglish / Hindi / Portuguese / Spanish).
const POSITIVE = [
  'good', 'great', 'excellent', 'perfect', 'thanks', 'thank', 'awesome', 'nice', 'happy', 'love',
  'badhiya', 'accha', 'acha', 'shukriya', 'dhanyavad', 'sahi',
  'bom', 'otimo', 'ótimo', 'obrigado', 'excelente',
  'bueno', 'gracias', 'excelente', 'genial',
];
const NEGATIVE = [
  'bad', 'worst', 'terrible', 'slow', 'poor', 'awful', 'angry', 'disappointed', 'horrible', 'useless', 'late',
  'ganda', 'kharab', 'bekar', 'bakwas', 'der',
  'ruim', 'pessimo', 'péssimo', 'horrivel', 'demorou', 'lento',
  'malo', 'pesimo', 'pésimo', 'lento', 'tarde',
];

export function rulesFallback(reply: string): ParserOutput {
  const t = reply.toLowerCase();

  // A stray digit 1-5 anywhere is a weak score signal.
  const m = t.match(/\b([1-5])\b/);
  const digitScore = m ? (Number(m[1]) as 1 | 2 | 3 | 4 | 5) : null;

  // Token-exact matching, so "bad" does not fire inside "badhiya".
  const tokens = new Set(t.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const pos = POSITIVE.some((w) => tokens.has(w));
  const neg = NEGATIVE.some((w) => tokens.has(w));
  const sentiment = neg && !pos ? 'negative' : pos && !neg ? 'positive' : 'neutral';

  let score = digitScore;
  if (score == null) {
    if (sentiment === 'positive') score = 4;
    else if (sentiment === 'negative') score = 2;
  }

  const isCsat = digitScore != null || pos || neg;

  return {
    is_csat_response: isCsat,
    score,
    confidence: 0.4, // low on purpose: fallback never clears the write-back threshold
    sentiment,
    reason_summary: 'rules fallback (LLM unavailable)',
    themes: [],
    new_issue: { present: false, summary: null },
    language: 'und',
  };
}
