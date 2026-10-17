import { getReviewQueue, CONSOLE_CHAT_URL } from '@/lib/stats';
import { approveResponse, dismissResponse } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function Review() {
  const queue = await getReviewQueue();

  return (
    <>
      <div className="page-head">
        <h1>Review queue</h1>
        <p>Low-confidence parses and media replies the AI wouldn&apos;t auto-write. Approve (optionally correcting the score) to write it back to Periskope, or dismiss it.</p>
      </div>

      {queue.length === 0 ? (
        <div className="card">
          <div className="empty">Nothing to review. 🎉</div>
        </div>
      ) : (
        queue.map((r) => (
          <div className="card" key={r.responseId}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <strong>{r.contactName ?? r.chatId}</strong>
                  <span style={{ color: 'var(--faint)' }}>· {r.subject}</span>
                  {r.isMedia && <span className="pill muted">media</span>}
                  {r.newIssue && <span className="pill bad">new issue</span>}
                </div>
                <div className="words" style={{ margin: '8px 0' }}>
                  {r.isMedia ? <em style={{ color: 'var(--faint)' }}>[media reply]</em> : `“${r.rawText}”`}
                </div>
                <div className="meta" style={{ color: 'var(--faint)', fontSize: 13 }}>
                  AI guess: {r.reason ?? '—'} · confidence {r.confidence ?? '—'} ·{' '}
                  <a href={CONSOLE_CHAT_URL(r.chatId)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                    open chat ↗
                  </a>
                </div>
              </div>
            </div>

            <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <form action={approveResponse} className="row" style={{ gap: 8 }}>
                <input type="hidden" name="responseId" value={r.responseId} />
                <select name="score" defaultValue={r.score ?? ''} style={{ width: 130 }}>
                  <option value="">No score</option>
                  <option value="1">1 — bad</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5 — great</option>
                </select>
                <button className="btn" type="submit">Approve &amp; write back</button>
              </form>
              <form action={dismissResponse}>
                <input type="hidden" name="responseId" value={r.responseId} />
                <button className="btn ghost" type="submit">Dismiss</button>
              </form>
            </div>
          </div>
        ))
      )}
    </>
  );
}
