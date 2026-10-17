// Pure eligibility rules for sending a CSAT survey. All DB/network facts are
// gathered by the caller and passed in, so this stays trivially testable.

export type EligibilityFacts = {
  chatType: string | null; // 'user' | 'business' | 'group' | null
  hasExternalRecipient: boolean; // at least one non-internal member
  labels: string[]; // combined ticket + chat labels, lowercased
  cooldownActive: boolean; // a recent survey to this contact exists
  surveyExistsForTicket: boolean; // idempotency: already handled
};

export type EligibilitySettings = {
  skipGroups: boolean;
  excludedLabels: string[];
};

export type EligibilityResult = { eligible: boolean; reason?: string };

const ONE_TO_ONE = new Set(['user', 'business']);

export function checkEligibility(
  facts: EligibilityFacts,
  settings: EligibilitySettings,
): EligibilityResult {
  // Idempotency first: never double-handle a ticket.
  if (facts.surveyExistsForTicket) {
    return { eligible: false, reason: 'survey_already_exists' };
  }

  // 1:1 only. A survey dropped in a group is spammy and the score is ambiguous.
  if (settings.skipGroups && !ONE_TO_ONE.has((facts.chatType ?? '').toLowerCase())) {
    return { eligible: false, reason: 'not_one_to_one' };
  }

  // Must have a real external customer to ask.
  if (!facts.hasExternalRecipient) {
    return { eligible: false, reason: 'no_external_recipient' };
  }

  // Excluded labels (no-csat / internal / spam …).
  const excluded = settings.excludedLabels.map((l) => l.toLowerCase());
  const hit = facts.labels.find((l) => excluded.includes(l));
  if (hit) {
    return { eligible: false, reason: `excluded_label:${hit}` };
  }

  // Cooldown: protects the WhatsApp number from spam reports.
  if (facts.cooldownActive) {
    return { eligible: false, reason: 'cooldown_active' };
  }

  return { eligible: true };
}

/** Split a comma-joined label string (Periskope's format) into lowercased names. */
export function parseLabels(...csv: Array<string | null | undefined>): string[] {
  return csv
    .filter(Boolean)
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
