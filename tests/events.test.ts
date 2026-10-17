import { describe, it, expect } from 'vitest';
import { extractIds, dedupeKey, type PeriskopeEnvelope } from '@/lib/events';

const ticketClosed: PeriskopeEnvelope = {
  event_type: 'ticket.updated',
  org_id: 'org1',
  timestamp: '2026-01-01T00:00:00Z',
  data: {
    ticket: { ticket_id: 'TKT-1', status: 'closed', subject: 'Invoice issue', assignee: 'a@x.com' },
    chat: { chat_id: '919999999999@c.us', chat_type: 'user' },
    message: {},
  },
};

const messageCreated: PeriskopeEnvelope = {
  event_type: 'message.created',
  org_id: 'org1',
  data: { message_id: 'MSG-1', chat_id: '919999999999@c.us', from_me: false, performed_by: null },
};

describe('extractIds', () => {
  it('pulls ticket id, chat id and status from a ticket.updated payload', () => {
    const ids = extractIds(ticketClosed);
    expect(ids.ticketId).toBe('TKT-1');
    expect(ids.chatId).toBe('919999999999@c.us');
    expect(ids.status).toBe('closed');
  });

  it('pulls message id and chat id from a message.created payload', () => {
    const ids = extractIds(messageCreated);
    expect(ids.messageId).toBe('MSG-1');
    expect(ids.chatId).toBe('919999999999@c.us');
    expect(ids.ticketId).toBeNull();
  });
});

describe('dedupeKey', () => {
  it('keys ticket events on type:ticket:status so a redelivered close collapses', () => {
    const k1 = dedupeKey(ticketClosed, extractIds(ticketClosed));
    const k2 = dedupeKey(ticketClosed, extractIds(ticketClosed));
    expect(k1).toBe('ticket.updated:TKT-1:closed');
    expect(k1).toBe(k2);
  });

  it('distinguishes a genuine status change from the same ticket', () => {
    const reopened: PeriskopeEnvelope = {
      ...ticketClosed,
      data: { ...ticketClosed.data, ticket: { ...ticketClosed.data.ticket, status: 'open' } },
    };
    const kClosed = dedupeKey(ticketClosed, extractIds(ticketClosed));
    const kOpen = dedupeKey(reopened, extractIds(reopened));
    expect(kClosed).not.toBe(kOpen);
  });

  it('keys message events on message id', () => {
    const k = dedupeKey(messageCreated, extractIds(messageCreated));
    expect(k).toBe('message.created:MSG-1');
  });
});
