import { getSettings } from '@/lib/settings';
import { saveSettings } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function Settings() {
  const s = await getSettings();

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Every knob in the survey flow. Safety rails (DRY_RUN, allowlist) also honour the environment — see below.</p>
      </div>

      <form action={saveSettings}>
        <div className="card">
          <h2>Timing &amp; thresholds</h2>
          <div className="grid-2">
            <Field label="Send delay (minutes)" name="delayMinutes" value={s.delayMinutes} hint="Wait after close before sending. Set 0 for an instant demo." />
            <Field label="Response window (hours)" name="responseWindowHours" value={s.responseWindowHours} />
            <Field label="Cooldown (days)" name="cooldownDays" value={s.cooldownDays} hint="Max one survey per customer per this many days." />
            <Field label="Low-score threshold" name="lowScoreThreshold" value={s.lowScoreThreshold} hint="Score ≤ this pings the agent." />
            <Field label="Send cap / hour" name="sendRatePerHour" value={s.sendRatePerHour} />
            <Field label="Min confidence" name="minConfidence" value={s.minConfidence} hint="Below this → review queue, no auto write-back." />
          </div>
        </div>

        <div className="card">
          <h2>Message &amp; routing</h2>
          <label className="field">
            <span className="lab">Survey template · {'{first_name}'} and {'{ticket_subject}'} are filled in</span>
            <textarea name="surveyTemplate" rows={3} defaultValue={s.surveyTemplate} />
          </label>
          <label className="field">
            <span className="lab">Lead email (fallback @mention when a ticket has no assignee)</span>
            <input name="leadEmail" defaultValue={s.leadEmail ?? ''} placeholder="lead@support.dev" />
          </label>
          <label className="field">
            <span className="lab">Excluded labels (comma-separated)</span>
            <input name="excludedLabels" defaultValue={s.excludedLabels.join(', ')} />
          </label>
        </div>

        <div className="card">
          <h2>Safety</h2>
          <label className="field">
            <span className="lab">Allowlist numbers (comma-separated; empty = no DB allowlist)</span>
            <input name="allowlistNumbers" defaultValue={s.allowlistNumbers.join(', ')} placeholder="919111111111" />
          </label>
          <label className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input type="checkbox" name="skipGroups" defaultChecked={s.skipGroups} style={{ width: 'auto' }} />
            <span>Skip group chats (recommended)</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" name="createTicketOnNewIssue" defaultChecked={s.createTicketOnNewIssue} style={{ width: 'auto' }} />
            <span>Create a ticket when a reply is a new issue</span>
          </label>
          <p style={{ color: 'var(--faint)', fontSize: 13, marginTop: 14 }}>
            <code className="mono">DRY_RUN</code> and <code className="mono">ALLOWLIST_NUMBERS</code> in the environment are hard rails that override these — a WhatsApp send is impossible when <code className="mono">DRY_RUN=true</code>, whatever this page says.
          </p>
        </div>

        <button className="btn" type="submit">Save settings</button>
      </form>
    </>
  );
}

function Field({ label, name, value, hint }: { label: string; name: string; value: string | number; hint?: string }) {
  return (
    <label className="field">
      <span className="lab">{label}</span>
      <input name={name} defaultValue={String(value)} />
      {hint && <span style={{ color: 'var(--faint)', fontSize: 12, display: 'block', marginTop: 4 }}>{hint}</span>}
    </label>
  );
}
