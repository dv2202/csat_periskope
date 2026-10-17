import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { verifyPeriskopeSignature } from '@/lib/signature';

const SECRET = 'test-signing-secret';

function hmac(payload: string) {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

describe('verifyPeriskopeSignature', () => {
  afterEach(() => {
    delete process.env.WEBHOOK_SKIP_SIGNATURE;
  });

  it('accepts a signature computed over the raw body', () => {
    const raw = '{"event_type":"ticket.updated","data":{}}';
    const res = verifyPeriskopeSignature(raw, hmac(raw), SECRET);
    expect(res).toEqual({ valid: true, variant: 'raw' });
  });

  it('accepts a signature computed over JSON.stringify(parsed)', () => {
    // Raw bytes have extra whitespace; the stringified form differs.
    const raw = '{ "a" : 1 }';
    const restringified = JSON.stringify(JSON.parse(raw));
    const res = verifyPeriskopeSignature(raw, hmac(restringified), SECRET);
    expect(res).toEqual({ valid: true, variant: 'stringify' });
  });

  it('rejects a wrong signature', () => {
    const raw = '{"x":1}';
    const res = verifyPeriskopeSignature(raw, 'deadbeef', SECRET);
    expect(res.valid).toBe(false);
  });

  it('rejects when header or secret is missing', () => {
    expect(verifyPeriskopeSignature('{}', null, SECRET).valid).toBe(false);
    expect(verifyPeriskopeSignature('{}', hmac('{}'), undefined).valid).toBe(false);
  });

  it('bypasses when WEBHOOK_SKIP_SIGNATURE=true (dev only)', () => {
    process.env.WEBHOOK_SKIP_SIGNATURE = 'true';
    const res = verifyPeriskopeSignature('{}', null, undefined);
    expect(res).toEqual({ valid: true, variant: 'skipped' });
  });

  it('is not fooled by a length-mismatched hex string', () => {
    const raw = '{"x":1}';
    const res = verifyPeriskopeSignature(raw, 'ab', SECRET);
    expect(res.valid).toBe(false);
  });
});
