# PRODUCT_BRIEF — CSAT + AI reply parser for Periskope

## The problem

Periskope's analytics measure **speed and volume**: first response time, resolution time, flagged messages, open tickets. They do **not** measure **outcome** — whether the customer was actually satisfied.

This matters more now that Periskope ships an **AI agent that self-trains on the team's resolved chats**. "Resolved" is the only quality label it currently learns from, and there is no customer-side signal. A chat can be marked resolved and still leave an angry customer; the agent would learn from it as a positive.

## Evidence

- Periskope's own analytics surface is speed/volume oriented (first response, resolution time, flagged, open tickets).
- A customer has publicly requested native CSAT on the feedback board — currently **"In Review"** on the roadmap: https://periskope.featurebase.app/p/native-csat-for-customer-support-evaluation

## What this is

An **external add-on**, built entirely on Periskope's public API and webhooks (no codebase access), that:

1. Sends a CSAT survey on WhatsApp when a support ticket is closed.
2. Captures the customer's reply.
3. Uses an LLM to turn any free-form reply into a structured score, reason and intent.
4. Writes the result **back into Periskope** — ticket custom properties and a private note that becomes a task.
5. Shows a manager dashboard.

## Users

- **Support lead / admin** — configures CSAT, reads the dashboard, works the review queue.
- **Agent** — gets an @mention/task when they get a low score on their ticket.
- **End customer** — receives one short WhatsApp message and replies however they like.

## Core flow

Ticket closed → eligibility (1:1 only, external recipient, not an excluded label, 7-day cooldown, one-per-ticket) → delay (default 10 min, re-checked at send) → send survey → response window (48h); first inbound reply, or one quoting the survey, is the candidate → AI parser → write-back (custom properties; low score → note/task; new issue → note) → or `no_response` if the window lapses.

## Key decisions & trade-offs (full log in DECISIONS.md)

- **External, API-only** — mirrors how a buyer would actually run it; de-risks a future native version.
- **Our own `tickets_seen` state** — `ticket.updated` omits the previous status, so a transition into closed is only knowable by diffing.
- **Delay before send + re-check** — avoids landing on the customer's "thanks!"; a quick reopen cancels.
- **Cooldown + rate cap + 1:1-only + DRY_RUN + allowlist** — the hard constraint is WhatsApp bans (docs: 3–5 spam reports can trigger enforcement), so protecting the number is a product requirement, not an afterthought.
- **fast-path before the LLM** — bare number / stars / thumb never cost an API call; free text goes to Gemini with a JSON schema, zod-validated, retried once, then a low-confidence rules fallback.
- **Confidence gate + review queue** — below 0.6 we don't auto-write; a human approves. Human-in-the-loop where the model is unsure.
- **Prompt injection treated as data** — the reply is wrapped and the model is told to ignore instructions inside it; structured output only. Covered by eval rows.

## Edge cases handled

Reopen before send (cancel) · reopen after score (keep, log as signal) · multiple tickets same chat (cooldown dedupe) · duplicate/out-of-order webhooks (idempotent by `event_type:ticket:status`) · media replies (stored `unparseable_media`, review) · multilingual (EN/Hinglish/Hindi/PT/ES) · sarcasm · mixed feedback + new issue · API down / 429 (retry with backoff, never double-send).

## Non-goals

NPS / email / SMS surveys · survey reminders · voice transcription · modifying Periskope's UI · multi-tenant billing.

## Success metrics (shown in the demo)

Response rate · CSAT % (share of 4–5) · median time-to-response · low-score → task latency · **parser accuracy on the labelled eval set** (91.2% exact / 97.1% ±1 on 44 rows, real Gemini).

## Risks

- WhatsApp enforcement — mitigated by cooldown, cap, 1:1-only, opt-out-friendly copy, allowlist, DRY_RUN default.
- Parser error on nuance (sarcasm) — mitigated by confidence gate + review queue + the ±1 tolerance in reporting.
- Docs vs reality gaps (signature form, poll votes, status strings) — tracked as `VERIFY` items in RESEARCH.md; a mock server lets us build now and a real number only flips one env var.

## What I'd do next

1. **Native in-product version** inside Periskope (no webhook round-trip, richer UI).
2. **CSAT split for AI-agent-handled vs human-handled** conversations, and feed low-CSAT chats into the AI agent's self-training as **negative examples** — directly closing the quality-signal gap that motivated this.
3. **Groups CSAT via polls**, if poll votes turn out to be observable over webhooks (currently unconfirmed — a `VERIFY` item).
