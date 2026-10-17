// Pure presentational helpers (no hooks) — usable from server components.

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="pill muted">—</span>;
  const cls = score >= 4 ? 'good' : score === 3 ? 'mid' : 'bad';
  return <span className={`pill ${cls}`}>{score}/5</span>;
}

export function SentimentPill({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const cls = sentiment === 'positive' ? 'good' : sentiment === 'neutral' ? 'mid' : 'bad';
  return <span className={`pill ${cls}`}>{sentiment}</span>;
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar">
      <span style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}
