import { getDashboard, trend30, groupBy, topThemes, CONSOLE_CHAT_URL } from '@/lib/stats';
import { pct, ScorePill, Bar } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const { overview: o, rows, scored } = await getDashboard();
  const trend = trend30(rows);
  const byAgent = groupBy(rows, 'assignee');
  const byLabel = groupBy(rows, 'label');
  const themes = topThemes(rows);
  const lowFeed = scored
    .filter((r) => (r.score ?? 5) <= 2)
    .slice(0, 8);

  const maxTrend = Math.max(0.01, ...trend.map((t) => t.csat ?? 0));

  return (
    <>
      <div className="page-head">
        <h1>Overview</h1>
        <p>Customer satisfaction outcomes across closed tickets — the signal Periskope&apos;s speed/volume analytics don&apos;t capture.</p>
      </div>

      <div className="kpis">
        <Kpi label="CSAT %" value={pct(o.csatPct)} sub={`${o.scored} scored`} />
        <Kpi label="Avg score" value={o.avgScore != null ? o.avgScore.toFixed(2) : '—'} sub="out of 5" />
        <Kpi label="Response rate" value={pct(o.responseRate)} sub={`${o.answered}/${o.answered + o.noResponse} replied`} />
        <Kpi label="Surveys sent" value={String(o.surveysSent)} sub={`${o.pending} pending · ${o.skipped} skipped`} />
        <Kpi label="Needs review" value={String(o.needsReview)} sub="low-confidence parses" />
      </div>

      <div className="card">
        <h2>Daily CSAT % — last 30 days</h2>
        {scored.length === 0 ? (
          <div className="empty">No responses yet. Run <code className="mono">npm run simulate</code> to seed demo data, or close a ticket in the mock.</div>
        ) : (
          <>
            <div className="spark">
              {trend.map((t) => (
                <div
                  className="col"
                  key={t.date}
                  title={`${t.date}: ${t.csat != null ? pct(t.csat) : 'no data'} (${t.n})`}
                >
                  <span style={{ height: `${t.csat != null ? (t.csat / maxTrend) * 100 : 0}%` }} />
                </div>
              ))}
            </div>
            <div className="meta" style={{ color: 'var(--faint)', fontSize: 12, marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>{trend[0].date}</span>
              <span>{trend[trend.length - 1].date}</span>
            </div>
          </>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>CSAT by agent</h2>
          <BreakdownTable rows={byAgent} />
        </div>
        <div className="card">
          <h2>CSAT by label</h2>
          <BreakdownTable rows={byLabel} />
        </div>
      </div>

      <div className="card">
        <h2>Top themes in low scores</h2>
        {themes.length === 0 ? (
          <div className="empty">No low-score themes yet.</div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {themes.map((t) => (
              <span key={t.theme} className="pill bad">
                {t.theme.replace(/_/g, ' ')} · {t.n}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Low-score feed</h2>
        {lowFeed.length === 0 ? (
          <div className="empty">No low scores. 🎉</div>
        ) : (
          lowFeed.map((r) => (
            <div className="feed-item" key={r.responseId}>
              <div className="row" style={{ gap: 8 }}>
                <ScorePill score={r.score} />
                <strong>{r.contactName ?? r.chatId}</strong>
                <span style={{ color: 'var(--faint)' }}>· {r.subject}</span>
              </div>
              <div className="words">“{r.rawText}”</div>
              <div className="meta">
                <span>AI: {r.reason}</span>
                {r.newIssue && <span className="pill mid">new issue</span>}
                <a href={CONSOLE_CHAT_URL(r.chatId)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                  open chat ↗
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function BreakdownTable({ rows }: { rows: { key: string; n: number; avg: number; csat: number }[] }) {
  if (rows.length === 0) return <div className="empty">No data yet.</div>;
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th className="num">n</th>
          <th className="num">Avg</th>
          <th style={{ width: '32%' }}>CSAT %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td className="num">{r.n}</td>
            <td className="num">{r.avg.toFixed(2)}</td>
            <td>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <Bar value={r.csat} />
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 13, minWidth: 34 }}>{pct(r.csat)}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
