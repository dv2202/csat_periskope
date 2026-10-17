import { getDashboard, CONSOLE_CHAT_URL } from '@/lib/stats';
import { ScorePill, SentimentPill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Responses() {
  const { rows } = await getDashboard();

  return (
    <>
      <div className="page-head">
        <h1>Responses</h1>
        <p>Every parsed customer reply. Score, sentiment and reason come from the AI parser; media replies are kept but not scored.</p>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">No responses yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Reply</th>
                <th>Score</th>
                <th>Sentiment</th>
                <th>AI reason</th>
                <th>Flags</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.responseId}>
                  <td>
                    <strong>{r.contactName ?? r.chatId}</strong>
                    <div style={{ color: 'var(--faint)', fontSize: 12 }}>{r.subject}</div>
                  </td>
                  <td style={{ maxWidth: 240 }}>{r.isMedia ? <em style={{ color: 'var(--faint)' }}>[media]</em> : `“${r.rawText}”`}</td>
                  <td><ScorePill score={r.score} /></td>
                  <td><SentimentPill sentiment={r.sentiment} /></td>
                  <td style={{ color: 'var(--muted)', maxWidth: 220 }}>{r.reason}</td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {r.needsReview && <span className="pill mid">review</span>}
                      {r.newIssue && <span className="pill bad">new issue</span>}
                      {r.isMedia && <span className="pill muted">media</span>}
                    </div>
                  </td>
                  <td>
                    <a href={CONSOLE_CHAT_URL(r.chatId)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                      chat ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
