# DEMO_SCRIPT — 2-minute Loom

Goal: show product judgment, not just code. The whole thing runs on the **mock Periskope server**, so no WhatsApp number is needed. Keep it to ~2 minutes.

## Setup before recording (off camera)

```bash
# .env: PERISKOPE_BASE_URL=http://localhost:4010, DRY_RUN=false, GEMINI_API_KEY set
npm run db:push            # once
npm run simulate           # seed ~60 surveys so the dashboard looks alive
npm run dev:all            # app :3000 + mock :4010
npm run worker             # separate terminal
```
On the Settings page set **Send delay = 0** so the survey sends on the next worker tick (~15s) instead of after 10 minutes.

Open two tabs: **http://localhost:3000** (dashboard) and **http://localhost:4010** (mock control panel).

## Script

**0:00 — The problem (20s).**
"Periskope's analytics measure speed and volume — first response time, resolution time, open tickets. None of them measure whether the customer was actually *happy*. And now that Periskope ships an AI agent that trains on resolved chats, 'resolved' is the only quality label it has. A customer's already asked for native CSAT on the roadmap." (Show the dashboard overview — CSAT %, by-agent, low-score feed — "this is the outcome layer that's missing.")

**0:20 — Close a ticket (25s).**
Switch to the mock panel. "When support closes a ticket in Periskope, we get a webhook." Click **Close ticket**. "We verify the signature, check eligibility — 1:1 only, not internal, not on cooldown — and schedule a survey after a short delay, so we don't land on top of the customer's 'thanks'." Show the worker terminal: `[survey] scheduled` → `[worker] sent survey`.

**0:45 — Customer replies in Hinglish (30s).**
In the panel, type `bekar service thi, 3 din lag gaye` and click **Customer replies** (leave "quote survey" ticked). "The customer replies however they like — here, Hinglish with a complaint. Our parser turns that free text into a structured score, reason and intent." Show the worker log: `score=1 path=llm`.

**1:15 — It lands back inside Periskope (25s).**
Back to the mock panel's ticket card: "The score and feedback are written onto the ticket's custom properties" (point to CSAT Score / CSAT Feedback). "And because it's a low score, we post a private note that @mentions the assignee — which Periskope turns into a task." Show the panel log line with the note + mention.

**1:40 — Dashboard + review queue (15s).**
Back to the dashboard: "Managers get CSAT by agent and by label, the themes behind low scores, and a review queue for anything the AI wasn't confident about — a human approves and it writes back." Click **Review queue**, approve one.

**1:55 — What's next (5s).**
"Next: the native in-product version, and splitting CSAT for AI-agent vs human-handled chats — feeding the low-CSAT ones back into the AI agent's training as negative examples."

## Notes
- If you have a real number later, the only change is `PERISKOPE_BASE_URL` + the signing secret — the app code is identical.
- Keep DRY_RUN awareness: against the mock it's `false` so writes are visible; against a real number keep it `true` until you've watched the allowlist work.
