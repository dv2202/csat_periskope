import { describe, it, expect } from 'vitest';
import { checkEligibility, parseLabels, type EligibilityFacts } from '@/lib/eligibility';

const settings = { skipGroups: true, excludedLabels: ['no-csat', 'internal', 'spam'] };

const base: EligibilityFacts = {
  chatType: 'user',
  hasExternalRecipient: true,
  labels: [],
  cooldownActive: false,
  surveyExistsForTicket: false,
};

describe('checkEligibility', () => {
  it('passes a clean 1:1 ticket', () => {
    expect(checkEligibility(base, settings)).toEqual({ eligible: true });
  });

  it('allows business chats as 1:1', () => {
    expect(checkEligibility({ ...base, chatType: 'business' }, settings).eligible).toBe(true);
  });

  it('skips groups', () => {
    expect(checkEligibility({ ...base, chatType: 'group' }, settings)).toEqual({
      eligible: false,
      reason: 'not_one_to_one',
    });
  });

  it('skips when no external recipient', () => {
    expect(checkEligibility({ ...base, hasExternalRecipient: false }, settings).reason).toBe(
      'no_external_recipient',
    );
  });

  it('skips on an excluded label', () => {
    expect(checkEligibility({ ...base, labels: ['vip', 'no-csat'] }, settings).reason).toBe(
      'excluded_label:no-csat',
    );
  });

  it('skips during cooldown', () => {
    expect(checkEligibility({ ...base, cooldownActive: true }, settings).reason).toBe('cooldown_active');
  });

  it('is idempotent: existing survey wins over everything', () => {
    expect(
      checkEligibility({ ...base, surveyExistsForTicket: true, chatType: 'group' }, settings).reason,
    ).toBe('survey_already_exists');
  });

  it('respects skipGroups=false', () => {
    expect(checkEligibility({ ...base, chatType: 'group' }, { ...settings, skipGroups: false }).eligible).toBe(
      true,
    );
  });
});

describe('parseLabels', () => {
  it('splits, trims and lowercases comma-joined label strings', () => {
    expect(parseLabels('VIP, No-CSAT', 'Spam')).toEqual(['vip', 'no-csat', 'spam']);
  });
  it('ignores empty / null', () => {
    expect(parseLabels('', null, undefined)).toEqual([]);
  });
});
