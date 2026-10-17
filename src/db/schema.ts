import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---- Enums -------------------------------------------------------------

// Ticket status values confirmed in docs (RESEARCH.md Q1).
export const ticketStatusEnum = pgEnum('ticket_status', [
  'open',
  'inprogress',
  'closed',
  'archived',
]);

// Lifecycle of a single CSAT survey.
export const surveyStatusEnum = pgEnum('survey_status', [
  'pending', // scheduled, not yet sent (inside the delay window)
  'sent', // survey message dispatched, awaiting a reply
  'answered', // a reply was matched and parsed
  'no_response', // response window expired with no reply
  'cancelled', // ticket reopened before send, or otherwise aborted
  'skipped', // failed an eligibility check (see skip_reason)
]);

// ---- Tables ------------------------------------------------------------

// Raw webhook log. Source of truth for idempotency + debugging.
// dedupe_key makes redelivered / out-of-order events harmless.
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    eventType: text('event_type').notNull(),
    orgId: text('org_id'),
    ticketId: text('ticket_id'),
    chatId: text('chat_id'),
    messageId: text('message_id'),
    signatureValid: boolean('signature_valid').notNull().default(false),
    signatureVariant: text('signature_variant'), // which HMAC variant matched (RESEARCH.md Q7)
    raw: jsonb('raw').notNull(),
    processed: boolean('processed').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dedupeUnique: uniqueIndex('webhook_events_dedupe_key_unique').on(t.dedupeKey),
    byType: index('webhook_events_event_type_idx').on(t.eventType),
  }),
);

// Last known status per ticket. We keep our own copy because ticket.updated
// never includes the previous status, so transitions are only detectable here.
export const ticketsSeen = pgTable('tickets_seen', {
  ticketId: text('ticket_id').primaryKey(),
  status: ticketStatusEnum('status').notNull(),
  chatId: text('chat_id'),
  subject: text('subject'),
  assignee: text('assignee'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per CSAT survey. Unique on ticket_id = one survey per ticket (idempotency).
export const surveys = pgTable(
  'surveys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ticketId: text('ticket_id').notNull(),
    chatId: text('chat_id').notNull(),
    contactId: text('contact_id'),
    contactPhone: text('contact_phone'),
    contactName: text('contact_name'),
    assignee: text('assignee'), // ticket assignee email, @mentioned on low scores
    labels: text('labels').array().notNull().default([]), // ticket/chat labels, for dashboard breakdowns
    status: surveyStatusEnum('status').notNull().default('pending'),
    skipReason: text('skip_reason'),
    ticketSubject: text('ticket_subject'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }), // when the delay elapses
    sentAt: timestamp('sent_at', { withTimezone: true }),
    surveyMessageId: text('survey_message_id'), // = send response unique_id (RESEARCH.md §3)
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    sendAttempts: integer('send_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ticketUnique: uniqueIndex('surveys_ticket_id_unique').on(t.ticketId),
    byStatus: index('surveys_status_idx').on(t.status),
    byContact: index('surveys_contact_idx').on(t.contactPhone),
  }),
);

// Parsed customer reply + write-back bookkeeping.
export const responses = pgTable('responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id, { onDelete: 'cascade' }),
  rawText: text('raw_text'),
  replyMessageId: text('reply_message_id'),
  quotedSurvey: boolean('quoted_survey').notNull().default(false), // high-confidence match
  isMedia: boolean('is_media').notNull().default(false), // unparseable_media
  parser: jsonb('parser'), // full validated parser output
  score: integer('score'), // 1..5 or null
  confidence: numeric('confidence'), // 0..1
  sentiment: text('sentiment'),
  newIssue: boolean('new_issue').notNull().default(false),
  needsReview: boolean('needs_review').notNull().default(false),
  writtenBackAt: timestamp('written_back_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Single-row config. id is pinned to 1.
export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  dryRun: boolean('dry_run').notNull().default(true),
  delayMinutes: integer('delay_minutes').notNull().default(10),
  responseWindowHours: integer('response_window_hours').notNull().default(48),
  cooldownDays: integer('cooldown_days').notNull().default(7),
  lowScoreThreshold: integer('low_score_threshold').notNull().default(2),
  minConfidence: numeric('min_confidence').notNull().default('0.6'),
  sendRatePerHour: integer('send_rate_per_hour').notNull().default(20),
  excludedLabels: text('excluded_labels').array().notNull().default(['no-csat', 'internal', 'spam']),
  surveyTemplate: text('survey_template')
    .notNull()
    .default(
      'Hi {first_name}, we’ve closed your request "{ticket_subject}". How did we do? Reply with a number from 1 (bad) to 5 (great), or just tell us in your own words.',
    ),
  leadEmail: text('lead_email'),
  createTicketOnNewIssue: boolean('create_ticket_on_new_issue').notNull().default(false),
  skipGroups: boolean('skip_groups').notNull().default(true),
  allowlistNumbers: text('allowlist_numbers').array().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type TicketSeen = typeof ticketsSeen.$inferSelect;
export type Survey = typeof surveys.$inferSelect;
export type ResponseRow = typeof responses.$inferSelect;
export type Settings = typeof settings.$inferSelect;
