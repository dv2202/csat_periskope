import 'dotenv/config';
import { db } from '../src/db';
import { surveys, responses, settings as settingsTable } from '../src/db/schema';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

/**
 * Seed ~60 believable CSAT surveys across 4 agents and 5 labels, spread over the
 * last 30 days, so the dashboard looks alive for a demo even with no live traffic.
 *
 * Writes directly to the DB (fast, deterministic, no LLM cost) rather than firing
 * webhooks. It CLEARS existing surveys + responses first — it's a dev seeder.
 */

const AGENTS = ['rahul@support.dev', 'meera@support.dev', 'john@support.dev', 'ana@support.dev'];
const LABELS = ['billing', 'onboarding', 'bug', 'feature-request', 'account'];
const SUBJECTS = [
  'Cannot download invoice',
  'Login not working',
  'How do I add a teammate?',
  'Payment failed twice',
  'Export is missing columns',
  'App crashes on upload',
  'Need to change my plan',
  'Webhook not firing',
];
const NAMES = ['Asha Verma', 'Carlos Mendes', 'Priya Nair', 'João Silva', 'Sofia García', 'Rohit Shah', 'Lucia Rossi', 'Dev Patel'];

const REASONS: Record<'pos' | 'neu' | 'neg', string[]> = {
  pos: ['fast and friendly help', 'issue resolved quickly', 'great support, very clear', 'agent was patient and helpful'],
  neu: ['resolved but took a while', 'okay, nothing special', 'fine in the end'],
  neg: ['waited days for a reply', 'issue still not fixed', 'slow and unclear communication', 'had to follow up repeatedly'],
};
const THEMES_NEG = ['speed', 'communication', 'resolution_quality', 'agent_attitude'];

const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const chance = (p: number) => Math.random() < p;
const daysAgo = (d: number, jitterH = 10) =>
  new Date(Date.now() - d * 86_400_000 - Math.floor(Math.random() * jitterH * 3_600_000));

function pickScore(): number {
  const r = Math.random();
  if (r < 0.35) return 5;
  if (r < 0.6) return 4;
  if (r < 0.75) return 3;
  if (r < 0.87) return 2;
  return 1;
}

async function main() {
  console.log('[simulate] clearing existing surveys + responses...');
  await db.delete(responses);
  await db.delete(surveys);

  // Ensure a settings row exists.
  await db.insert(settingsTable).values({ id: 1, ...DEFAULT_SETTINGS }).onConflictDoNothing();

  const N = 60;
  const surveyRows: any[] = [];
  const responseRows: Array<{ ticketIndex: number; values: any }> = [];

  for (let i = 0; i < N; i++) {
    const agent = rand(AGENTS);
    const name = rand(NAMES);
    const subject = rand(SUBJECTS);
    const chatId = `9190000${String(1000 + i)}@c.us`;
    const labels = chance(0.5) ? [rand(LABELS), rand(LABELS)] : [rand(LABELS)];
    const dayOffset = Math.floor(Math.random() * 30);

    // Outcome
    const roll = Math.random();
    if (roll < 0.1) {
      // skipped
      surveyRows.push({
        ticketId: `SIM-${i}`,
        chatId,
        contactPhone: chatId,
        contactName: name,
        assignee: agent,
        labels,
        ticketSubject: subject,
        status: 'skipped',
        skipReason: rand(['cooldown_active', 'not_one_to_one', 'excluded_label:spam']),
        createdAt: daysAgo(dayOffset),
      });
      continue;
    }
    if (roll < 0.14) {
      // pending (future send)
      surveyRows.push({
        ticketId: `SIM-${i}`,
        chatId,
        contactPhone: chatId,
        contactName: name,
        assignee: agent,
        labels,
        ticketSubject: subject,
        status: 'pending',
        scheduledAt: new Date(Date.now() + 5 * 60_000),
        createdAt: daysAgo(0),
      });
      continue;
    }

    const sentAt = daysAgo(dayOffset);
    const windowExpiresAt = new Date(sentAt.getTime() + 48 * 3_600_000);

    if (roll < 0.28) {
      // no_response
      surveyRows.push({
        ticketId: `SIM-${i}`,
        chatId,
        contactPhone: chatId,
        contactName: name,
        assignee: agent,
        labels,
        ticketSubject: subject,
        status: 'no_response',
        sentAt,
        surveyMessageId: `SIM-MSG-${i}`,
        windowExpiresAt,
        createdAt: new Date(sentAt.getTime() - 600_000),
      });
      continue;
    }

    // answered
    const answeredAt = new Date(sentAt.getTime() + Math.floor(Math.random() * 6 * 3_600_000));
    const isMedia = chance(0.05);
    const needsReview = !isMedia && chance(0.08);
    const newIssue = chance(0.12);

    surveyRows.push({
      ticketId: `SIM-${i}`,
      chatId,
      contactPhone: chatId,
      contactName: name,
      assignee: agent,
      labels,
      ticketSubject: subject,
      status: 'answered',
      sentAt,
      answeredAt,
      surveyMessageId: `SIM-MSG-${i}`,
      windowExpiresAt,
      createdAt: new Date(sentAt.getTime() - 600_000),
    });

    if (isMedia) {
      responseRows.push({
        ticketIndex: i,
        values: {
          rawText: '[media]',
          isMedia: true,
          quotedSurvey: false,
          parser: null,
          score: null,
          confidence: null,
          sentiment: null,
          newIssue: false,
          needsReview: true,
          createdAt: answeredAt,
        },
      });
      continue;
    }

    const score = pickScore();
    const bucket = score >= 4 ? 'pos' : score === 3 ? 'neu' : 'neg';
    const sentiment = score >= 4 ? 'positive' : score === 3 ? 'neutral' : 'negative';
    const reason = rand(REASONS[bucket]);
    const themes = bucket === 'neg' ? [rand(THEMES_NEG)] : [];
    const confidence = needsReview ? 0.45 + Math.random() * 0.1 : 0.72 + Math.random() * 0.25;

    responseRows.push({
      ticketIndex: i,
      values: {
        rawText: sampleReply(score),
        isMedia: false,
        quotedSurvey: chance(0.6),
        parser: {
          is_csat_response: true,
          score,
          confidence,
          sentiment,
          reason_summary: reason,
          themes,
          new_issue: { present: newIssue, summary: newIssue ? 'mentions a separate problem' : null },
          language: rand(['en', 'hi', 'pt', 'es']),
          _path: chance(0.2) ? 'fast' : 'llm',
        },
        score: needsReview ? null : score,
        confidence: String(confidence.toFixed(2)),
        sentiment,
        newIssue,
        needsReview,
        writtenBackAt: needsReview ? null : answeredAt,
        createdAt: answeredAt,
      },
    });
  }

  const inserted = await db.insert(surveys).values(surveyRows).returning({ id: surveys.id, ticketId: surveys.ticketId });
  const idByTicket = new Map(inserted.map((r) => [r.ticketId, r.id]));

  const respValues = responseRows.map((r) => ({
    surveyId: idByTicket.get(`SIM-${r.ticketIndex}`)!,
    ...r.values,
  }));
  if (respValues.length) await db.insert(responses).values(respValues);

  console.log(`[simulate] seeded ${surveyRows.length} surveys, ${respValues.length} responses.`);
  console.log('[simulate] open http://localhost:3000 to see the dashboard.');
  process.exit(0);
}

function sampleReply(score: number): string {
  const pool: Record<number, string[]> = {
    5: ['5 bahut badhiya service 🙏', 'Excellent, thank you so much!', 'ótimo atendimento, obrigado'],
    4: ['pretty good, thanks', 'resolved quickly 👍', 'good support'],
    3: ['it was okay', 'theek tha', 'foi ok'],
    2: ['not great, quite slow', 'bekar service thi', 'meh, took too long'],
    1: ['terrible, waited 3 days', 'worst experience', 'péssimo, muito lento'],
  };
  return rand(pool[score]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
