import { eq } from 'drizzle-orm';
import { db } from '../db';
import { settings, type Settings } from '../db/schema';

// Defaults mirror the schema column defaults so a missing row still works.
export const DEFAULT_SETTINGS: Omit<Settings, 'id' | 'updatedAt'> = {
  dryRun: true,
  delayMinutes: 10,
  responseWindowHours: 48,
  cooldownDays: 7,
  lowScoreThreshold: 2,
  minConfidence: '0.6',
  sendRatePerHour: 20,
  excludedLabels: ['no-csat', 'internal', 'spam'],
  surveyTemplate:
    'Hi {first_name}, we’ve closed your request "{ticket_subject}". How did we do? Reply with a number from 1 (bad) to 5 (great), or just tell us in your own words.',
  leadEmail: null,
  createTicketOnNewIssue: false,
  skipGroups: true,
  allowlistNumbers: [],
};

/** Read the single settings row, seeding it from defaults if absent. */
export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (rows[0]) return rows[0];

  const inserted = await db
    .insert(settings)
    .values({ id: 1, ...DEFAULT_SETTINGS })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) return inserted[0];

  // Lost a race; re-read.
  const reread = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return reread[0];
}

/**
 * Env-level overrides that act as hard safety rails regardless of the DB row.
 * DRY_RUN and the allowlist can be forced on from the environment.
 */
export function envDryRun(): boolean {
  return process.env.DRY_RUN !== 'false';
}

export function envAllowlist(): string[] {
  return (process.env.ALLOWLIST_NUMBERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
