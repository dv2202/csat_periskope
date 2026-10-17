import 'dotenv/config';
import { tick } from '../src/lib/worker';

/**
 * DB-backed job worker. Polls due work every ~15s:
 *   - send pending surveys whose scheduled_at has elapsed (re-checking the ticket
 *     is still closed right before sending)
 *   - expire response windows -> no_response
 *
 * Why a DB-backed poller and not Redis/BullMQ: the job volume is tiny (surveys,
 * not high-throughput events), the jobs are already durable rows in Postgres,
 * and a single ~15s tick keeps the whole system to one datastore. Adding Redis
 * would be operational weight with no payoff at this scale. (DECISIONS.md)
 */

const TICK_MS = 15_000;

async function main() {
  console.log(`[worker] started (dryRun=${process.env.DRY_RUN !== 'false'}), tick=${TICK_MS}ms`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error('[worker] tick error', err);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
