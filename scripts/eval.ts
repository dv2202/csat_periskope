import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseReply } from '../src/lib/parser';

/**
 * Runs the parser over the labelled eval set and prints accuracy for:
 *   - score (exact and ±1), over items with a non-null expected score
 *   - is_csat_response
 *   - new_issue detection
 * Also breaks down which code path handled each reply (fast / llm / fallback).
 *
 * Without GEMINI_API_KEY the LLM path errors and items fall back to rules, so the
 * nuanced-language rows will score lower — the harness reports whatever is real.
 */

type Row = {
  id: string;
  reply: string;
  ticket_subject?: string;
  expected: { is_csat_response: boolean; score: number | null; new_issue: boolean };
};

async function main() {
  const file = join(__dirname, '..', 'evals', 'csat_replies.jsonl');
  const rows: Row[] = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const paths: Record<string, number> = { fast: 0, llm: 0, fallback: 0, media: 0 };
  let scoreExactHit = 0,
    scoreWithinHit = 0,
    scoreTotal = 0;
  let csatHit = 0;
  let newIssueHit = 0;
  const misses: string[] = [];

  // Run with limited concurrency so the LLM path isn't painfully serial.
  const CONCURRENCY = 6;
  const graded = new Array<{ output: any; path: string; r: Row }>(rows.length);
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      batch.map((r) =>
        parseReply({
          surveyText: 'How did we do? Reply 1 (bad) to 5 (great).',
          ticketSubject: r.ticket_subject ?? '',
          context: [],
          reply: r.reply,
        }).then((res) => ({ ...res, r })),
      ),
    );
    out.forEach((o, j) => (graded[i + j] = o));
  }

  for (const { output, path, r } of graded) {
    paths[path] = (paths[path] ?? 0) + 1;
    if (output.is_csat_response === r.expected.is_csat_response) csatHit++;
    if (output.new_issue.present === r.expected.new_issue) newIssueHit++;
    if (r.expected.score != null) {
      scoreTotal++;
      const got = output.score;
      if (got === r.expected.score) scoreExactHit++;
      if (got != null && Math.abs(got - r.expected.score) <= 1) scoreWithinHit++;
      if (got !== r.expected.score) misses.push(`${r.id}: got ${got} want ${r.expected.score} (${path})`);
    }
  }

  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + '%' : 'n/a');
  const n = rows.length;

  console.log('\nCSAT parser eval');
  console.log('='.repeat(42));
  console.log(`examples:            ${n}`);
  console.log(`score exact:         ${pct(scoreExactHit, scoreTotal)}  (${scoreExactHit}/${scoreTotal})`);
  console.log(`score ±1:            ${pct(scoreWithinHit, scoreTotal)}  (${scoreWithinHit}/${scoreTotal})`);
  console.log(`is_csat_response:    ${pct(csatHit, n)}  (${csatHit}/${n})`);
  console.log(`new_issue detect:    ${pct(newIssueHit, n)}  (${newIssueHit}/${n})`);
  console.log(`paths:               fast=${paths.fast} llm=${paths.llm} fallback=${paths.fallback}`);
  if (!process.env.GEMINI_API_KEY) {
    console.log('\nNOTE: GEMINI_API_KEY not set -> non-fast items used the rules fallback.');
    console.log('      Set the key to measure true LLM accuracy.');
  }
  if (misses.length) {
    console.log('\nscore misses:');
    for (const m of misses) console.log('  ' + m);
  }
  console.log();
}

main().then(() => process.exit(0));
