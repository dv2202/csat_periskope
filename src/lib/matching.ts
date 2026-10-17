// Pure reply-matching + contact extraction helpers.

export type SurveyMatchState = {
  surveyMessageId: string | null;
  sentAt: Date | null;
  windowExpiresAt: Date | null;
};

export type InboundMessage = {
  fromMe: boolean;
  quotedMessageId: string | null;
  timestamp: Date;
};

export type MatchResult = 'quote' | 'window' | 'none';

/**
 * Decide whether an inbound message is the reply to a sent survey.
 * - 'quote'  : the message quotes our survey message id -> high confidence
 * - 'window' : first inbound from the customer within the response window
 * - 'none'   : not a match (outbound, before send, or past the window)
 *
 * Because the caller only considers surveys still in status 'sent' and flips the
 * survey to 'answered' on the first match, the "first inbound after send" rule
 * falls out naturally.
 */
export function classifyReplyMatch(survey: SurveyMatchState, msg: InboundMessage): MatchResult {
  if (msg.fromMe) return 'none';

  if (
    msg.quotedMessageId &&
    survey.surveyMessageId &&
    msg.quotedMessageId === survey.surveyMessageId
  ) {
    return 'quote';
  }

  if (!survey.sentAt) return 'none';
  if (msg.timestamp < survey.sentAt) return 'none';
  if (survey.windowExpiresAt && msg.timestamp > survey.windowExpiresAt) return 'none';

  return 'window';
}

export type Member = {
  contact_id: string;
  contact_name?: string | null;
  is_internal?: boolean;
};

export type ExtractedCustomer = {
  contactId: string;
  name: string | null;
};

/** Pick the external (non-internal) participant of a 1:1 chat. */
export function extractCustomer(chat: any): ExtractedCustomer | null {
  const members: Record<string, Member> = chat?.members ?? {};
  for (const m of Object.values(members)) {
    if (m && m.is_internal === false) {
      return { contactId: m.contact_id, name: m.contact_name ?? null };
    }
  }
  return null;
}

export function hasExternalRecipient(chat: any): boolean {
  const members: Record<string, Member> = chat?.members ?? {};
  return Object.values(members).some((m) => m && m.is_internal === false);
}

/** Normalize a WhatsApp id / number to bare digits for allowlist comparison. */
export function normalizePhone(x: string | null | undefined): string {
  return (x ?? '').replace(/\D/g, '');
}

export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || 'there';
}

export function renderTemplate(tpl: string, vars: { firstName: string; subject: string }): string {
  return tpl
    .replace(/\{first_name\}/g, vars.firstName)
    .replace(/\{ticket_subject\}/g, vars.subject);
}
