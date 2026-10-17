import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { surveys, responses } from '../db/schema';

export const CONSOLE_CHAT_URL = (chatId: string) =>
  `https://console.periskope.app/chats/${encodeURIComponent(chatId)}`;

export type ScoredRow = {
  responseId: string;
  ticketId: string;
  chatId: string;
  assignee: string | null;
  labels: string[];
  subject: string | null;
  contactName: string | null;
  score: number | null;
  sentiment: string | null;
  confidence: string | null;
  rawText: string | null;
  reason: string | null;
  themes: string[];
  newIssue: boolean;
  needsReview: boolean;
  isMedia: boolean;
  answeredAt: Date | null;
};

async function answeredRows(): Promise<ScoredRow[]> {
  const rows = await db
    .select()
    .from(responses)
    .innerJoin(surveys, eq(responses.surveyId, surveys.id))
    .orderBy(desc(responses.createdAt));

  return rows.map((r) => {
    const parser = (r.responses.parser ?? {}) as any;
    return {
      responseId: r.responses.id,
      ticketId: r.surveys.ticketId,
      chatId: r.surveys.chatId,
      assignee: r.surveys.assignee,
      labels: r.surveys.labels ?? [],
      subject: r.surveys.ticketSubject,
      contactName: r.surveys.contactName,
      score: r.responses.score,
      sentiment: r.responses.sentiment,
      confidence: r.responses.confidence,
      rawText: r.responses.rawText,
      reason: parser.reason_summary ?? null,
      themes: Array.isArray(parser.themes) ? parser.themes : [],
      newIssue: r.responses.newIssue,
      needsReview: r.responses.needsReview,
      isMedia: r.responses.isMedia,
      answeredAt: r.surveys.answeredAt,
    };
  });
}

export type Overview = {
  surveysSent: number;
  answered: number;
  noResponse: number;
  responseRate: number; // 0..1
  csatPct: number; // 0..1 over scored
  avgScore: number | null;
  scored: number;
  needsReview: number;
  lowScore: number;
  newIssues: number;
  pending: number;
  skipped: number;
};

export async function getDashboard() {
  const rows = await answeredRows();
  const statusCounts = await db
    .select({ status: surveys.status })
    .from(surveys);
  const count = (s: string) => statusCounts.filter((x) => x.status === s).length;

  const scored = rows.filter((r) => r.score != null);
  const good = scored.filter((r) => (r.score ?? 0) >= 4).length;
  const avg = scored.length
    ? scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length
    : null;

  const answered = count('answered');
  const noResponse = count('no_response');
  const sent = count('sent') + answered + noResponse;

  const overview: Overview = {
    surveysSent: sent,
    answered,
    noResponse,
    responseRate: answered + noResponse ? answered / (answered + noResponse) : 0,
    csatPct: scored.length ? good / scored.length : 0,
    avgScore: avg,
    scored: scored.length,
    needsReview: rows.filter((r) => r.needsReview).length,
    lowScore: scored.filter((r) => (r.score ?? 0) <= 2).length,
    newIssues: rows.filter((r) => r.newIssue).length,
    pending: count('pending'),
    skipped: count('skipped'),
  };

  return { overview, rows, scored };
}

export function trend30(rows: ScoredRow[]) {
  const days: { date: string; csat: number | null; n: number }[] = [];
  const byDay = new Map<string, ScoredRow[]>();
  for (const r of rows) {
    if (r.score == null || !r.answeredAt) continue;
    const key = new Date(r.answeredAt).toISOString().slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const arr = byDay.get(d) ?? [];
    const good = arr.filter((r) => (r.score ?? 0) >= 4).length;
    days.push({ date: d, csat: arr.length ? good / arr.length : null, n: arr.length });
  }
  return days;
}

export function groupBy(rows: ScoredRow[], key: 'assignee' | 'label') {
  const map = new Map<string, { n: number; good: number; sum: number }>();
  for (const r of rows) {
    if (r.score == null) continue;
    const keys = key === 'assignee' ? [r.assignee ?? 'unassigned'] : r.labels.length ? r.labels : ['(none)'];
    for (const k of keys) {
      const g = map.get(k) ?? { n: 0, good: 0, sum: 0 };
      g.n += 1;
      g.sum += r.score;
      if (r.score >= 4) g.good += 1;
      map.set(k, g);
    }
  }
  return [...map.entries()]
    .map(([k, g]) => ({ key: k, n: g.n, avg: g.sum / g.n, csat: g.good / g.n }))
    .sort((a, b) => b.n - a.n);
}

export function topThemes(rows: ScoredRow[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    if ((r.score ?? 5) > 2) continue; // low scores only
    for (const t of r.themes) map.set(t, (map.get(t) ?? 0) + 1);
  }
  return [...map.entries()].map(([theme, n]) => ({ theme, n })).sort((a, b) => b.n - a.n);
}

export async function getReviewQueue(): Promise<ScoredRow[]> {
  const rows = await answeredRows();
  return rows.filter((r) => r.needsReview);
}
