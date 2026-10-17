'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { responses, surveys, settings as settingsTable } from '@/db/schema';
import { getSettings } from '@/lib/settings';
import { writeBack } from '@/lib/writeback';
import type { ParserOutput } from '@/lib/parser';

/** Approve a reviewed response (optionally correcting the score) and write it back. */
export async function approveResponse(formData: FormData) {
  const responseId = String(formData.get('responseId'));
  const scoreRaw = formData.get('score');
  const score = scoreRaw && scoreRaw !== '' ? Number(scoreRaw) : null;

  const rows = await db
    .select()
    .from(responses)
    .innerJoin(surveys, eq(responses.surveyId, surveys.id))
    .where(eq(responses.id, responseId))
    .limit(1);
  const row = rows[0];
  if (!row) return;

  const stored = (row.responses.parser ?? {}) as ParserOutput & Record<string, unknown>;
  const parser: ParserOutput = {
    ...stored,
    score: (score as ParserOutput['score']) ?? null,
    is_csat_response: score != null ? true : stored.is_csat_response ?? false,
    reason_summary: stored.reason_summary ?? 'reviewed by human',
    themes: Array.isArray(stored.themes) ? stored.themes : [],
    new_issue: stored.new_issue ?? { present: false, summary: null },
    sentiment: stored.sentiment ?? 'neutral',
    confidence: 1,
    language: stored.language ?? 'und',
  };

  await db
    .update(responses)
    .set({ needsReview: false, score, confidence: '1', parser: parser as object })
    .where(eq(responses.id, responseId));

  const liveSettings = await getSettings();
  try {
    await writeBack({
      survey: row.surveys,
      responseId,
      parser,
      rawText: row.responses.rawText ?? '',
      writeScore: score != null,
      settings: liveSettings,
    });
  } catch {
    // leave written_back_at null; the worker retries
  }

  revalidatePath('/review');
  revalidatePath('/responses');
  revalidatePath('/');
}

/** Dismiss a reviewed response without recording a score. */
export async function dismissResponse(formData: FormData) {
  const responseId = String(formData.get('responseId'));
  await db
    .update(responses)
    .set({ needsReview: false, score: null, writtenBackAt: new Date() })
    .where(eq(responses.id, responseId));
  revalidatePath('/review');
  revalidatePath('/');
}

export async function saveSettings(formData: FormData) {
  const num = (k: string, d: number) => {
    const v = formData.get(k);
    const n = v == null || v === '' ? d : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const current = await getSettings();

  await db
    .update(settingsTable)
    .set({
      delayMinutes: num('delayMinutes', current.delayMinutes),
      responseWindowHours: num('responseWindowHours', current.responseWindowHours),
      cooldownDays: num('cooldownDays', current.cooldownDays),
      lowScoreThreshold: num('lowScoreThreshold', current.lowScoreThreshold),
      sendRatePerHour: num('sendRatePerHour', current.sendRatePerHour),
      minConfidence: String(formData.get('minConfidence') || current.minConfidence),
      surveyTemplate: String(formData.get('surveyTemplate') || current.surveyTemplate),
      leadEmail: (String(formData.get('leadEmail') || '').trim() || null) as string | null,
      skipGroups: formData.get('skipGroups') === 'on',
      createTicketOnNewIssue: formData.get('createTicketOnNewIssue') === 'on',
      excludedLabels: String(formData.get('excludedLabels') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      allowlistNumbers: String(formData.get('allowlistNumbers') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      updatedAt: new Date(),
    })
    .where(eq(settingsTable.id, 1));

  revalidatePath('/settings');
}
