import { eq } from 'drizzle-orm';
import { db } from '../db';
import { responses, type Survey } from '../db/schema';
import { periskope } from './periskope';
import type { Settings } from '../db/schema';
import type { ParserOutput } from './parser';

export const CSAT_SCORE_PROP = 'CSAT Score';
export const CSAT_FEEDBACK_PROP = 'CSAT Feedback';

/**
 * Write a parsed result back into Periskope:
 *   - set the ticket's CSAT Score + CSAT Feedback custom properties (when we have
 *     a confident score)
 *   - on a low score (<= threshold), post a private note @mentioning the assignee
 *     (fallback: lead email) — Periskope turns the @mention into a task
 *   - on a new-issue reply, post a note so the team picks it up
 *
 * Idempotency: sets responses.written_back_at; the worker only retries rows where
 * it is still null. DRY_RUN logs the note instead of sending (it's not a WhatsApp
 * send, but a note is still outbound-ish, so we keep it behind the rail).
 */
export async function writeBack(args: {
  survey: Survey;
  responseId: string;
  parser: ParserOutput;
  rawText: string;
  writeScore: boolean; // false when needs_review
  settings: Settings;
}): Promise<void> {
  const { survey, responseId, parser, rawText, writeScore, settings } = args;
  const assignee = survey.assignee || settings.leadEmail || null;
  const mention = assignee ? ` @${assignee}` : '';
  const subject = survey.ticketSubject || 'your request';

  // 1. Custom properties (only with a confident score).
  if (writeScore && parser.is_csat_response && parser.score != null) {
    await periskope.updateTicket(survey.ticketId, {
      custom_properties: {
        [CSAT_SCORE_PROP]: String(parser.score),
        [CSAT_FEEDBACK_PROP]: parser.reason_summary,
      },
    });

    // 2. Low-score alert note -> task.
    if (parser.score <= settings.lowScoreThreshold) {
      const note =
        `⚠️ *Low CSAT* ${parser.score}/5 on "${subject}".\n` +
        `Reason: ${parser.reason_summary}\n` +
        `Customer said: "${rawText}"${mention}`;
      await periskope.createNote({ chat_id: survey.chatId, message: note });
    }
  }

  // 3. New-issue note (independent of score).
  if (parser.new_issue.present) {
    const note =
      `🆕 Customer replied to the CSAT survey with a new issue: ${parser.new_issue.summary ?? rawText}.${mention}`;
    await periskope.createNote({ chat_id: survey.chatId, message: note });
    if (settings.createTicketOnNewIssue) {
      // Optional: a Create Ticket call would go here. Left as a note-only action
      // until the Create Ticket endpoint is wired (and VERIFYd on a real account).
      console.log('[writeback] createTicketOnNewIssue set, but Create Ticket API not wired yet');
    }
  }

  await db.update(responses).set({ writtenBackAt: new Date() }).where(eq(responses.id, responseId));
}
