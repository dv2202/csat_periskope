import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { webhookEvents, ticketsSeen } from '@/db/schema';
import { verifyPeriskopeSignature } from '@/lib/signature';
import { extractIds, dedupeKey, type PeriskopeEnvelope } from '@/lib/events';
import { handleTicketClosed, handleTicketReopened, handleInboundMessage } from '@/lib/survey';

// Must run on Node (crypto HMAC + postgres), never edge. No caching.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KNOWN_STATUSES = new Set(['open', 'inprogress', 'closed', 'archived']);

export async function POST(req: NextRequest) {
  // Read the RAW body before any parsing so signature verification can hash the
  // exact bytes Periskope signed (RESEARCH.md Q7).
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('x-periskope-signature');

  const sig = verifyPeriskopeSignature(
    rawBody,
    signatureHeader,
    process.env.PERISKOPE_SIGNING_SECRET,
  );

  if (!sig.valid) {
    // Reject hard so a misconfigured secret is loud, not silent.
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let env: PeriskopeEnvelope;
  try {
    env = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ids = extractIds(env);
  const key = dedupeKey(env, ids);

  // Store raw event. ON CONFLICT DO NOTHING on dedupe_key = idempotent ingest.
  const inserted = await db
    .insert(webhookEvents)
    .values({
      dedupeKey: key,
      eventType: env.event_type,
      orgId: env.org_id ?? null,
      ticketId: ids.ticketId,
      chatId: ids.chatId,
      messageId: ids.messageId,
      signatureValid: sig.valid,
      signatureVariant: sig.variant,
      raw: env as unknown as object,
    })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning({ id: webhookEvents.id });

  // Duplicate delivery: already processed, ack and stop.
  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await route(env, ids);
  } catch (err) {
    // Never fail the webhook over downstream processing; it is logged raw and
    // can be reprocessed from webhook_events. Return 200 so Periskope does not retry-storm.
    console.error('[webhook] processing error', env.event_type, err);
  }

  return NextResponse.json({ ok: true });
}

async function route(env: PeriskopeEnvelope, ids: ReturnType<typeof extractIds>) {
  switch (env.event_type) {
    case 'ticket.created':
    case 'ticket.updated':
      await handleTicket(env, ids);
      break;
    case 'message.created':
      await handleInboundMessage(env);
      break;
    default:
      break;
  }
}

async function handleTicket(env: PeriskopeEnvelope, ids: ReturnType<typeof extractIds>) {
  const ticket = env.data?.ticket ?? {};
  const status = (ids.status ?? '').toLowerCase();
  if (!ids.ticketId || !KNOWN_STATUSES.has(status)) return;

  // Read previous known status to detect the transition INTO closed.
  const prevRows = await db
    .select({ status: ticketsSeen.status })
    .from(ticketsSeen)
    .where(sql`${ticketsSeen.ticketId} = ${ids.ticketId}`)
    .limit(1);
  const prevStatus = prevRows[0]?.status ?? null;

  // Upsert our state copy.
  await db
    .insert(ticketsSeen)
    .values({
      ticketId: ids.ticketId,
      status: status as any,
      chatId: ids.chatId,
      subject: ticket.subject ?? null,
      assignee: ticket.assignee || null,
    })
    .onConflictDoUpdate({
      target: ticketsSeen.ticketId,
      set: {
        status: status as any,
        chatId: ids.chatId,
        subject: ticket.subject ?? null,
        assignee: ticket.assignee || null,
        updatedAt: new Date(),
      },
    });

  const enteredClosed = status === 'closed' && prevStatus !== 'closed';
  const leftClosed = prevStatus === 'closed' && status !== 'closed';

  if (enteredClosed) {
    await handleTicketClosed(env);
  }
  if (leftClosed) {
    await handleTicketReopened(ids.ticketId);
  }
}
