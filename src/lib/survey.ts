import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { surveys, responses } from '../db/schema';
import { getSettings } from './settings';
import { checkEligibility, parseLabels, type EligibilityFacts } from './eligibility';
import { classifyReplyMatch, extractCustomer, hasExternalRecipient } from './matching';
import { parseReply, needsReview } from './parser';
import { writeBack } from './writeback';
import type { PeriskopeEnvelope } from './events';

const MEDIA_TYPES = new Set(['image', 'sticker', 'audio', 'ptt', 'video', 'document']);
const DAY_MS = 86_400_000;

/**
 * Ticket entered 'closed'. Run eligibility and, if it passes, schedule a pending
 * survey for `delayMinutes` from now. Ineligible tickets are recorded as skipped
 * (with the reason) for dashboard visibility, except when a survey already exists.
 */
export async function handleTicketClosed(env: PeriskopeEnvelope): Promise<void> {
  const data = env.data ?? {};
  const ticket = data.ticket ?? {};
  const chat = data.chat ?? null;
  const ticketId: string | undefined = ticket.ticket_id;
  const chatId: string | undefined = chat?.chat_id;

  if (!ticketId || !chatId || !chat) {
    // chat can be null per docs; without it we cannot evaluate eligibility.
    console.warn('[survey] closed ticket missing chat/chat_id', ticketId);
    return;
  }

  const settings = await getSettings();
  const customer = extractCustomer(chat);

  const existing = await db
    .select({ id: surveys.id })
    .from(surveys)
    .where(eq(surveys.ticketId, ticketId))
    .limit(1);

  let cooldownActive = false;
  if (customer && chatId) {
    const since = new Date(Date.now() - settings.cooldownDays * DAY_MS);
    const recent = await db
      .select({ id: surveys.id })
      .from(surveys)
      .where(
        and(
          eq(surveys.chatId, chatId),
          inArray(surveys.status, ['pending', 'sent', 'answered']),
          gte(surveys.createdAt, since),
        ),
      )
      .limit(1);
    cooldownActive = recent.length > 0;
  }

  const facts: EligibilityFacts = {
    chatType: chat.chat_type ?? null,
    hasExternalRecipient: hasExternalRecipient(chat),
    labels: parseLabels(ticket.ticket_labels, chat.chat_labels),
    cooldownActive,
    surveyExistsForTicket: existing.length > 0,
  };

  const verdict = checkEligibility(facts, settings);

  if (!verdict.eligible) {
    if (verdict.reason === 'survey_already_exists') return; // idempotent no-op
    await db
      .insert(surveys)
      .values({
        ticketId,
        chatId,
        contactId: customer?.contactId ?? null,
        contactPhone: chatId,
        contactName: customer?.name ?? null,
        assignee: ticket.assignee || null,
        labels: facts.labels,
        ticketSubject: ticket.subject ?? null,
        status: 'skipped',
        skipReason: verdict.reason,
      })
      .onConflictDoNothing({ target: surveys.ticketId });
    console.log('[survey] skipped', ticketId, verdict.reason);
    return;
  }

  const scheduledAt = new Date(Date.now() + settings.delayMinutes * 60_000);
  await db
    .insert(surveys)
    .values({
      ticketId,
      chatId,
      contactId: customer?.contactId ?? null,
      contactPhone: chatId,
      contactName: customer?.name ?? null,
      assignee: ticket.assignee || null,
      labels: facts.labels,
      ticketSubject: ticket.subject ?? null,
      status: 'pending',
      scheduledAt,
    })
    .onConflictDoNothing({ target: surveys.ticketId });
  console.log('[survey] scheduled', ticketId, 'at', scheduledAt.toISOString());
}

/**
 * Ticket left 'closed'. If a survey is still pending (not yet sent), cancel it.
 * If it was already sent/answered, keep it but log the reopen as a quality signal.
 */
export async function handleTicketReopened(ticketId: string): Promise<void> {
  const rows = await db
    .select({ id: surveys.id, status: surveys.status })
    .from(surveys)
    .where(eq(surveys.ticketId, ticketId))
    .limit(1);
  const s = rows[0];
  if (!s) return;

  if (s.status === 'pending') {
    await db
      .update(surveys)
      .set({ status: 'cancelled', skipReason: 'reopened_before_send' })
      .where(eq(surveys.id, s.id));
    console.log('[survey] cancelled (reopened before send)', ticketId);
  } else if (s.status === 'sent' || s.status === 'answered') {
    console.log('[survey] ticket reopened after survey', ticketId, 'status', s.status);
  }
}

/**
 * An inbound customer message arrived. If it matches a sent survey, store the
 * reply, run the parser, and mark the survey answered. Write-back to Periskope
 * (custom properties + low-score note) is M4 and runs from the worker.
 */
export async function handleInboundMessage(env: PeriskopeEnvelope): Promise<void> {
  const msg = env.data ?? {};
  if (msg.from_me !== false) return; // only inbound customer messages
  const chatId: string | undefined = msg.chat_id;
  if (!chatId) return;

  const rows = await db
    .select()
    .from(surveys)
    .where(and(eq(surveys.chatId, chatId), eq(surveys.status, 'sent')))
    .orderBy(desc(surveys.sentAt))
    .limit(1);
  const survey = rows[0];
  if (!survey) return;

  const match = classifyReplyMatch(
    {
      surveyMessageId: survey.surveyMessageId,
      sentAt: survey.sentAt,
      windowExpiresAt: survey.windowExpiresAt,
    },
    {
      fromMe: false,
      quotedMessageId: msg.quoted_message_id ?? null,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    },
  );
  if (match === 'none') return;

  const settings = await getSettings();
  const isMedia = MEDIA_TYPES.has(msg.message_type) || (!!msg.has_media && !msg.body);
  const rawText: string = msg.body ?? '';

  // Media-only replies: store as unparseable (transcription is a non-goal).
  if (isMedia) {
    await recordResponse(survey.id, {
      rawText: rawText || '[media]',
      replyMessageId: msg.message_id ?? null,
      quotedSurvey: match === 'quote',
      isMedia: true,
      parser: null,
      score: null,
      confidence: null,
      sentiment: null,
      newIssue: false,
      needsReview: true,
    });
    await markAnswered(survey.id);
    console.log('[survey] answered with media (unparseable)', survey.ticketId);
    return;
  }

  const { output, path } = await parseReply({
    surveyText: settings.surveyTemplate,
    ticketSubject: survey.ticketSubject ?? '',
    context: [],
    reply: rawText,
  });

  const review = needsReview(output, Number(settings.minConfidence));

  const responseId = await recordResponse(survey.id, {
    rawText,
    replyMessageId: msg.message_id ?? null,
    quotedSurvey: match === 'quote',
    isMedia: false,
    parser: { ...output, _path: path },
    score: output.is_csat_response ? output.score : null,
    confidence: String(output.confidence),
    sentiment: output.sentiment,
    newIssue: output.new_issue.present,
    needsReview: review,
  });
  await markAnswered(survey.id);

  // Confident results write back immediately. Low-confidence ones wait in the
  // review queue (a human approves, which triggers the write-back then).
  if (!review) {
    try {
      await writeBack({
        survey,
        responseId,
        parser: output,
        rawText,
        writeScore: output.is_csat_response && output.score != null,
        settings,
      });
    } catch (err) {
      console.error('[survey] writeback failed, worker will retry', survey.ticketId, err);
    }
  }

  console.log(
    `[survey] answered ${survey.ticketId} score=${output.score} path=${path} review=${review} newIssue=${output.new_issue.present}`,
  );
}

async function recordResponse(
  surveyId: string,
  v: {
    rawText: string;
    replyMessageId: string | null;
    quotedSurvey: boolean;
    isMedia: boolean;
    parser: unknown;
    score: number | null;
    confidence: string | null;
    sentiment: string | null;
    newIssue: boolean;
    needsReview: boolean;
  },
): Promise<string> {
  const rows = await db
    .insert(responses)
    .values({
      surveyId,
      rawText: v.rawText,
      replyMessageId: v.replyMessageId,
      quotedSurvey: v.quotedSurvey,
      isMedia: v.isMedia,
      parser: v.parser as object | null,
      score: v.score,
      confidence: v.confidence,
      sentiment: v.sentiment,
      newIssue: v.newIssue,
      needsReview: v.needsReview,
    })
    .returning({ id: responses.id });
  return rows[0].id;
}

async function markAnswered(surveyId: string) {
  await db
    .update(surveys)
    .set({ status: 'answered', answeredAt: new Date() })
    .where(eq(surveys.id, surveyId));
}
