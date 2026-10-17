import 'dotenv/config';
import { periskope, PeriskopeError } from '../src/lib/periskope';

/**
 * Idempotently create the two ticket custom properties the add-on writes to:
 *   - "CSAT Score"    : dropdown, options "1".."5"
 *   - "CSAT Feedback" : text
 *
 * Creation returns stable option ids; we print them so they can be cross-checked.
 * Re-running is safe: a 409 (already exists) is treated as success.
 * Finally prints the webhook URL and the events to subscribe to.
 */

const SCORE_PROP = 'CSAT Score';
const FEEDBACK_PROP = 'CSAT Feedback';
const SCORE_OPTIONS = ['1', '2', '3', '4', '5'];

async function ensureProperty(
  name: string,
  kind: 'dropdown' | 'text',
  options?: string[],
): Promise<void> {
  try {
    const res = await periskope.createProperty({
      name,
      type: 'ticket',
      kind,
      options,
    });
    const opts = res.data?.options;
    console.log(`  created "${name}" (${kind}) property_id=${res.data?.property_id}`);
    if (opts?.length) {
      for (const o of opts) console.log(`      option ${o.label} -> id ${o.id}`);
    }
  } catch (err) {
    if (err instanceof PeriskopeError && err.status === 409) {
      console.log(`  "${name}" already exists — skipping (idempotent).`);
      return;
    }
    throw err;
  }
}

async function main() {
  const missing = ['PERISKOPE_API_KEY', 'PERISKOPE_PHONE'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}. Fill .env.local first.`);
    process.exit(1);
  }

  console.log('Ensuring ticket custom properties...');
  await ensureProperty(SCORE_PROP, 'dropdown', SCORE_OPTIONS);
  await ensureProperty(FEEDBACK_PROP, 'text');

  const base = process.env.PUBLIC_WEBHOOK_URL || process.env.APP_BASE_URL || 'https://<your-tunnel>';
  const webhookUrl = `${base.replace(/\/$/, '')}/api/webhooks/periskope`;

  console.log('\nWebhook configuration (set in Periskope: Settings > Webhooks):');
  console.log(`  URL: ${webhookUrl}`);
  console.log('  Subscribe to events:');
  console.log('    - ticket.created');
  console.log('    - ticket.updated');
  console.log('    - message.created');
  console.log('    - message.updated   (for poll-vote detection test)');
  console.log('    - note.created');
  console.log('\n  Copy the Signing Key into PERISKOPE_SIGNING_SECRET.');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('setup failed:', err instanceof PeriskopeError ? `${err.status} ${err.message}` : err);
  process.exit(1);
});
