// Helpers for parsing the Periskope webhook envelope and extracting the
// identifiers we key idempotency on. Field locations are per RESEARCH.md.

export type PeriskopeEnvelope = {
  event_type: string;
  data: any;
  org_id?: string;
  timestamp?: string;
};

export type ExtractedIds = {
  ticketId: string | null;
  chatId: string | null;
  messageId: string | null;
  status: string | null;
};

export function extractIds(env: PeriskopeEnvelope): ExtractedIds {
  const data = env.data ?? {};
  const ticket = data.ticket ?? {};
  const chat = data.chat ?? {};
  const message = data.message ?? data; // message.* events put the object at data root

  return {
    ticketId: ticket.ticket_id ?? data.ticket_id ?? null,
    // ticket.updated carries chat_id under data.chat (RESEARCH.md Q2)
    chatId: chat.chat_id ?? message.chat_id ?? data.chat_id ?? null,
    messageId: message.message_id ?? data.message_id ?? null,
    status: ticket.status ?? data.status ?? null,
  };
}

/**
 * Stable idempotency key. Ticket events key on ticket + status so a redelivered
 * "closed" event collapses, while a genuine status change is a new key.
 * Message events key on message id. Everything else falls back to type+timestamp.
 */
export function dedupeKey(env: PeriskopeEnvelope, ids: ExtractedIds): string {
  if (env.event_type.startsWith('ticket.')) {
    return `${env.event_type}:${ids.ticketId ?? 'unknown'}:${ids.status ?? 'na'}`;
  }
  if (env.event_type.startsWith('message.')) {
    return `${env.event_type}:${ids.messageId ?? 'unknown'}`;
  }
  return `${env.event_type}:${env.timestamp ?? Date.now()}`;
}
