import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import { db } from '../db';
import { surveys, responses, ticketsSeen } from '../db/schema';
import { getSettings, envAllowlist } from './settings';
import { periskope } from './periskope';
import { firstName, normalizePhone, renderTemplate } from './matching';
import { writeBack } from './writeback';
import type { ParserOutput } from './parser';

/** One worker pass: send due surveys, expire stale windows, retry write-backs. */
export async function tick(): Promise<void> {
  await sendDue();
  await expireWindows();
  await retryWriteBacks();
}

async function sendDue(): Promise<void> {
  const settings = await getSettings();
  const now = new Date();

  const due = await db
    .select()
    .from(surveys)
    .where(and(eq(surveys.status, 'pending'), lte(surveys.scheduledAt, now)))
    .limit(25);
  if (due.length === 0) return;

  // Global send-rate cap: how many were sent in the last hour.
  const hourAgo = new Date(Date.now() - 3_600_000);
  const sentRecently = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(and(eq(surveys.status, 'sent'), gte(surveys.sentAt, hourAgo)));
  let budget = Math.max(0, settings.sendRatePerHour - sentRecently.length);

  // Allowlist: env ∪ db. When non-empty, only these numbers may receive a survey.
  const allow = [...envAllowlist(), ...settings.allowlistNumbers].map(normalizePhone).filter(Boolean);

  for (const s of due) {
    if (budget <= 0) break; // remaining stay pending for the next tick

    // Re-check the ticket is STILL closed right before sending (reopen guard).
    const seen = await db
      .select({ status: ticketsSeen.status })
      .from(ticketsSeen)
      .where(eq(ticketsSeen.ticketId, s.ticketId))
      .limit(1);
    if (seen[0] && seen[0].status !== 'closed') {
      await db
        .update(surveys)
        .set({ status: 'cancelled', skipReason: 'reopened_before_send' })
        .where(eq(surveys.id, s.id));
      continue;
    }

    // Allowlist gate.
    if (allow.length > 0 && !allow.includes(normalizePhone(s.contactPhone))) {
      await db
        .update(surveys)
        .set({ status: 'skipped', skipReason: 'not_allowlisted' })
        .where(eq(surveys.id, s.id));
      continue;
    }

    const text = renderTemplate(settings.surveyTemplate, {
      firstName: firstName(s.contactName),
      subject: s.ticketSubject ?? 'your request',
    });

    try {
      const res = await periskope.sendMessage({ chat_id: s.chatId, message: text });
      const sentAt = new Date();
      const windowExpiresAt = new Date(sentAt.getTime() + settings.responseWindowHours * 3_600_000);
      await db
        .update(surveys)
        .set({
          status: 'sent',
          sentAt,
          surveyMessageId: res.unique_id,
          windowExpiresAt,
          sendAttempts: s.sendAttempts + 1,
        })
        .where(eq(surveys.id, s.id));
      budget -= 1;
      console.log(`[worker] sent survey ${s.ticketId} -> ${s.chatId} (${res.unique_id})`);
    } catch (err) {
      await db
        .update(surveys)
        .set({ sendAttempts: s.sendAttempts + 1 })
        .where(eq(surveys.id, s.id));
      console.error('[worker] send failed, will retry', s.ticketId, err);
    }
  }
}

async function expireWindows(): Promise<void> {
  const now = new Date();
  const expired = await db
    .update(surveys)
    .set({ status: 'no_response' })
    .where(and(eq(surveys.status, 'sent'), lte(surveys.windowExpiresAt, now)))
    .returning({ id: surveys.id, ticketId: surveys.ticketId });
  for (const e of expired) console.log('[worker] window expired -> no_response', e.ticketId);
}

/** Retry write-backs that haven't landed yet (confident, non-media responses). */
async function retryWriteBacks(): Promise<void> {
  const settings = await getSettings();
  const rows = await db
    .select()
    .from(responses)
    .innerJoin(surveys, eq(responses.surveyId, surveys.id))
    .where(
      and(
        isNull(responses.writtenBackAt),
        eq(responses.needsReview, false),
        eq(responses.isMedia, false),
      ),
    )
    .limit(20);

  for (const row of rows) {
    const parser = row.responses.parser as (ParserOutput & { _path?: string }) | null;
    if (!parser) continue;
    try {
      await writeBack({
        survey: row.surveys,
        responseId: row.responses.id,
        parser,
        rawText: row.responses.rawText ?? '',
        writeScore: parser.is_csat_response && parser.score != null,
        settings,
      });
      console.log('[worker] write-back retried', row.surveys.ticketId);
    } catch (err) {
      console.error('[worker] write-back retry failed', row.surveys.ticketId, err);
    }
  }
}
