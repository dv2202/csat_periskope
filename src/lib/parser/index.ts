import { parserOutputSchema, type ParseResult, type ParserOutput } from './schema';
import { fastPath } from './fastPath';
import { callGemini, type ParserInput } from './gemini';
import { rulesFallback } from './fallback';

export * from './schema';
export type { ParserInput } from './gemini';

/**
 * Parse a customer reply into a structured CSAT result.
 *
 * Order (cost/latency/robustness):
 *   1. fast path   — bare number / stars / thumb, no LLM call
 *   2. LLM         — Gemini structured output, validated with zod, retried once
 *   3. rules       — deterministic keyword fallback (low confidence)
 */
export async function parseReply(input: ParserInput): Promise<ParseResult> {
  const fast = fastPath(input.reply);
  if (fast) return { output: fast, path: 'fast' };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callGemini(input);
      const parsed = parserOutputSchema.safeParse(raw);
      if (parsed.success) {
        return { output: normalize(parsed.data), path: 'llm' };
      }
      // validation failed -> retry once, then fall through
      if (attempt === 2) break;
    } catch {
      if (attempt === 2) break;
    }
  }

  return { output: rulesFallback(input.reply), path: 'fallback' };
}

// Guard invariants the model occasionally violates despite the schema.
function normalize(o: ParserOutput): ParserOutput {
  const out = { ...o };
  if (!out.is_csat_response) out.score = out.score; // keep; a new issue can still carry a score
  if (out.score != null && (out.score < 1 || out.score > 5)) out.score = null;
  out.confidence = Math.max(0, Math.min(1, out.confidence));
  return out;
}

/** Whether this result should be written back or held for human review. */
export function needsReview(output: ParserOutput, minConfidence: number): boolean {
  if (!output.is_csat_response) return false; // not a score; handled as new-issue/skip
  if (output.score == null) return true;
  return output.confidence < minConfidence;
}
