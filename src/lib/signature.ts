import { createHmac, timingSafeEqual } from 'crypto';

export type SignatureResult = {
  valid: boolean;
  variant: 'raw' | 'stringify' | 'skipped' | null;
};

/**
 * Verify Periskope's x-periskope-signature header.
 *
 * The docs are internally inconsistent (RESEARCH.md Q7): the prose says the HMAC
 * is computed over the raw request body, but the sample re-serializes with
 * JSON.stringify(req.body). Re-stringifying may not reproduce the signed bytes,
 * so we try the raw body first, then the stringified form, and record which one
 * matched so we can harden to a single path once we see real traffic.
 *
 * Algorithm: HMAC-SHA256, hex digest. Comparison is constant-time.
 */
export function verifyPeriskopeSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
): SignatureResult {
  // Explicit dev bypass so the local simulator can post unsigned events.
  if (process.env.WEBHOOK_SKIP_SIGNATURE === 'true') {
    return { valid: true, variant: 'skipped' };
  }

  if (!signatureHeader || !secret) {
    return { valid: false, variant: null };
  }

  const candidates: Array<{ variant: 'raw' | 'stringify'; payload: string }> = [
    { variant: 'raw', payload: rawBody },
  ];

  // Only add the re-stringified candidate if the body is valid JSON.
  try {
    candidates.push({ variant: 'stringify', payload: JSON.stringify(JSON.parse(rawBody)) });
  } catch {
    // not JSON; raw candidate is all we have
  }

  for (const { variant, payload } of candidates) {
    const digest = createHmac('sha256', secret).update(payload).digest('hex');
    if (safeEqualHex(digest, signatureHeader.trim())) {
      return { valid: true, variant };
    }
  }

  return { valid: false, variant: null };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
