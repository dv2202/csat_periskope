import { describe, it, expect } from 'vitest';
import {
  classifyReplyMatch,
  extractCustomer,
  hasExternalRecipient,
  normalizePhone,
  firstName,
  renderTemplate,
} from '@/lib/matching';

const sent = new Date('2026-01-01T10:00:00Z');
const windowEnd = new Date('2026-01-03T10:00:00Z');
const survey = { surveyMessageId: 'SURVEY-1', sentAt: sent, windowExpiresAt: windowEnd };

describe('classifyReplyMatch', () => {
  it('ignores outbound messages', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: true, quotedMessageId: null, timestamp: new Date('2026-01-01T11:00:00Z') }),
    ).toBe('none');
  });

  it('matches a quote of the survey with high confidence', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: false, quotedMessageId: 'SURVEY-1', timestamp: new Date('2026-01-01T11:00:00Z') }),
    ).toBe('quote');
  });

  it('matches the first inbound within the window', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: false, quotedMessageId: null, timestamp: new Date('2026-01-01T12:00:00Z') }),
    ).toBe('window');
  });

  it('rejects a message before the survey was sent', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: false, quotedMessageId: null, timestamp: new Date('2026-01-01T09:00:00Z') }),
    ).toBe('none');
  });

  it('rejects a message past the window', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: false, quotedMessageId: null, timestamp: new Date('2026-01-05T10:00:00Z') }),
    ).toBe('none');
  });

  it('a quote still matches even past the window', () => {
    expect(
      classifyReplyMatch(survey, { fromMe: false, quotedMessageId: 'SURVEY-1', timestamp: new Date('2026-01-09T10:00:00Z') }),
    ).toBe('quote');
  });
});

describe('extractCustomer / hasExternalRecipient', () => {
  const chat = {
    members: {
      c1: { contact_id: 'c1', contact_name: 'Asha Verma', is_internal: false },
      a1: { contact_id: 'a1', contact_name: 'Agent', is_internal: true },
    },
  };
  it('picks the non-internal member', () => {
    expect(extractCustomer(chat)).toEqual({ contactId: 'c1', name: 'Asha Verma' });
  });
  it('detects an external recipient', () => {
    expect(hasExternalRecipient(chat)).toBe(true);
  });
  it('returns null when everyone is internal', () => {
    const allInternal = { members: { a1: { contact_id: 'a1', is_internal: true } } };
    expect(extractCustomer(allInternal)).toBeNull();
    expect(hasExternalRecipient(allInternal)).toBe(false);
  });
});

describe('helpers', () => {
  it('normalizePhone strips non-digits', () => {
    expect(normalizePhone('919111111111@c.us')).toBe('919111111111');
    expect(normalizePhone('+91 91111-11111')).toBe('919111111111');
  });
  it('firstName falls back to "there"', () => {
    expect(firstName('Asha Verma')).toBe('Asha');
    expect(firstName('')).toBe('there');
    expect(firstName(null)).toBe('there');
  });
  it('renderTemplate fills placeholders', () => {
    expect(
      renderTemplate('Hi {first_name}, about "{ticket_subject}"', { firstName: 'Asha', subject: 'Invoice' }),
    ).toBe('Hi Asha, about "Invoice"');
  });
});
