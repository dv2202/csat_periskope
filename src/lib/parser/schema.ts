import { z } from 'zod';

// Fixed theme taxonomy. The parser may only use these.
export const THEMES = [
  'speed',
  'resolution_quality',
  'agent_attitude',
  'product_issue',
  'pricing',
  'communication',
  'other',
] as const;

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const;

export const parserOutputSchema = z.object({
  is_csat_response: z.boolean(),
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  confidence: z.number().min(0).max(1),
  sentiment: z.enum(SENTIMENTS),
  reason_summary: z.string().max(200),
  themes: z.array(z.enum(THEMES)),
  new_issue: z.object({
    present: z.boolean(),
    summary: z.string().nullable(),
  }),
  language: z.string(),
});

export type ParserOutput = z.infer<typeof parserOutputSchema>;

export type ParsePath = 'fast' | 'llm' | 'fallback' | 'media';

export type ParseResult = {
  output: ParserOutput;
  path: ParsePath;
};

// Schema handed to Gemini (structured output). Kept in sync with the zod schema.
// Uses plain JSON-schema-ish shape accepted by @google/genai responseSchema.
export const geminiResponseSchema = {
  type: 'object',
  properties: {
    is_csat_response: { type: 'boolean' },
    score: { type: 'integer', nullable: true, description: '1..5 or null' },
    confidence: { type: 'number', description: '0..1' },
    sentiment: { type: 'string', enum: [...SENTIMENTS] },
    reason_summary: { type: 'string', description: '<= 15 words, English' },
    themes: { type: 'array', items: { type: 'string', enum: [...THEMES] } },
    new_issue: {
      type: 'object',
      properties: {
        present: { type: 'boolean' },
        summary: { type: 'string', nullable: true },
      },
      required: ['present', 'summary'],
    },
    language: { type: 'string', description: 'ISO 639-1 code' },
  },
  required: [
    'is_csat_response',
    'score',
    'confidence',
    'sentiment',
    'reason_summary',
    'themes',
    'new_issue',
    'language',
  ],
} as const;
