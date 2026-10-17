# RESEARCH — Periskope API & Webhooks (Phase 0)

Source of truth: docs fetched 2026-10-17 from `https://docs.periskope.app`. Where the docs are silent or contradictory, I flag it and say how the add-on will handle it. **Everything marked `VERIFY` must be re-checked against real logged payloads once a live number is connected (M1).** When docs and reality disagree, reality wins and the discrepancy gets logged here — that is also useful feedback for Periskope.

---

## 1. Confirmed facts

### Auth
- Two headers: `Authorization: Bearer <API_KEY>` and `x-phone: <countrycode+number>` (e.g. `919876512340`), or a `phone-xxxx` phone_id.
- Base URL: `https://api.periskope.app/v1`.
- No separate org id header; the phone identifies the sending account. `org_id` arrives inside payloads.
- API key is generated in console API settings, shown once.

### Webhook envelope
Every event is wrapped:
```json
{ "event_type": "...", "data": { ... }, "org_id": "...", "timestamp": "..." }
```
Endpoint must be public, accept POST, no auth, return 200 fast.

### Endpoints we will use
| Action | Method + path |
|---|---|
| Send message | `POST /v1/message/send` |
| Message status | `GET /v1/message/{unique_id}/status` |
| Get ticket by id | `GET /v1/tickets/{ticket_id}` |
| Update ticket | `PATCH /v1/tickets/{ticket_id}` |
| Create custom property | `POST /v1/properties/create` |
| Get custom property | `GET /v1/properties/...` (confirm path, `VERIFY`) |
| Create private note | `POST /v1/notes/create` |
| Get chat by id | `GET /v1/chat/...` (`VERIFY` exact path) |
| Get messages in chat | `GET /v1/chat/.../messages` (`VERIFY`) |

### SDK
`@periskope/periskope-client`. Init `new PeriskopeApi({ authToken, phone })`. Only `client.messages.sendMessage({chat_id, message})` is documented on the SDK page; other resources not shown, so `VERIFY` method names or fall back to typed `fetch` generated from the OpenAPI spec.
Event-emitter mode: `client.connect()` then `client.on('message.created', cb)`. Transport unnamed ("socket"). This gives an **ingestion path with no public URL** — good for local dev. `VERIFY` which events the emitter actually delivers and whether signature applies.

---

## 2. The eight questions

### Q1 — Ticket status values + detecting transition into `closed`
**Status values: `open`, `inprogress`, `closed`, `archived`** (confirmed in Ticket Info object doc and Update Ticket doc).
`ticket.updated` carries **no previous status** — only the current `ticket.status`. So we cannot detect a transition from the payload alone.
**Decision:** keep our own `tickets_seen` table (last known status per `ticket_id`). On each `ticket.updated`, compare stored status vs incoming; "entered closed" = stored != closed AND incoming == closed. First sighting already-closed → treat as a transition once (configurable) to avoid missing closes that happened before we were subscribed. Also note `ticket.closed_at` / `ticket.closed_by` exist and help confirm.

### Q2 — Does `ticket.updated` include `chat_id`?
**Yes, indirectly.** The payload `data` has four keys: `chat`, `message`, `ticket`, `attached_messages`. `chat.chat_id` is present (format `<cc><number>@c.us` for 1:1, `<id>@g.us` for group). The `ticket` object itself has **no** `chat_id`.
**Decision:** read `data.chat.chat_id`. If `chat` is null (doc says it can be), fall back to `GET /tickets/{id}`. `VERIFY` that `chat` is reliably populated on live `ticket.updated`.
Bonus: `chat.chat_type` (`user` / `group`) and `chat.members[].is_internal` are in the same payload — enough to run eligibility checks without an extra call.

### Q3 — Can ticket custom properties be set via Update Ticket? Can we create CSAT props?
**Yes.** `PATCH /v1/tickets/{id}` accepts a `custom_properties` object. Key = property **name or property_id** (case-insensitive). Value by kind:
- dropdown → an option **id or label**
- text → any string
- picklist → array/CSV of ids or labels
- clear → `null` / `""` / `[]`; omitted props unchanged.

Create props via `POST /v1/properties/create`:
- "CSAT Score": `{ name, type:"ticket", kind:"dropdown", options:["1","2","3","4","5"] }` → response returns stable option `{id,label}` pairs. **Store the ids**, not labels (ids are stable for the option's lifetime).
- "CSAT Feedback": `{ name, type:"ticket", kind:"text" }`.
No documented 1–5 option cap. 409 if name already exists (per type). `VERIFY` get-property path for idempotent setup; otherwise catch 409.

### Q4 — Inbound vs outbound, internal vs external, performed_by
- **Direction:** `message.from_me` boolean. `false` = inbound (customer). `true` = outbound (us). Also `from` / `to` / `author`.
- **Internal:** there is **no `is_internal` on the message object**. It lives on `chat.members[].is_internal`. So we classify the sender by looking up their `contact_id` in chat members. `VERIFY` with real payload.
- **`performed_by`:** member email for a human/member action, `"api"` for API-sent, **`null`** for messages received from WhatsApp (customer). So: customer reply → `from_me:false` + `performed_by:null`.
- **AI-agent-sent:** not documented. Likely an email or a special value in `performed_by`. `VERIFY` / record whatever appears (stretch goal).

### Q5 — Does a quoting reply carry `quoted_message_id`?
**Yes.** Message object has `quoted_message_id` (string or null) and `has_quoted_msg` boolean. A reply that quotes our survey message → `quoted_message_id` = survey message id. This is our **high-confidence match**. `VERIFY` the id format matches what we stored from the send response.

### Q6 — Do poll votes trigger a webhook?
**Unconfirmed / likely no.** Send supports polls (`poll: {pollName, pollOptions[2..12], options.allowMultipleAnswers}`), message_type `poll_creation`, and the Message object carries `poll_info` + `poll_results` (voter id → timestamp per option). BUT `message.updated` is documented only as "triggered when a message is edited on WhatsApp" — nothing ties a poll **vote** to any webhook.
**Decision:** poll mode stays a **stretch goal, gated on live verification.** MVP uses the free-text/number reply flow. Record the finding either way (good feedback for Periskope). `VERIFY`: cast a poll vote on a test number, watch for `message.updated` / `poll_results` delta.

### Q7 — HMAC over raw body or re-stringified JSON?
Header: **`x-periskope-signature`**. Algorithm: **HMAC-SHA256, hex digest**. Secret: the **Signing Key** from Settings > Webhooks.
**Docs are internally inconsistent:** prose says use the raw body "before any parsing", the sample does `JSON.stringify(req.body)` on parsed JSON. Re-stringify may not reproduce the signed bytes. Doc also mentions the key must be "decrypted" but the sample uses it directly — unclear.
**Decision:** capture the **raw body** in the Next.js route (disable body parsing / read the raw stream), then verify in this order, accepting on first match: (1) HMAC over raw bytes, (2) HMAC over `JSON.stringify(parsedBody)`. Use constant-time compare (`crypto.timingSafeEqual`), which the sample omits. Log which variant matched so we can harden to one path after M1. `VERIFY` the "decrypted key" wording against a real signature.

### Q8 — Webhook rate limits / retries
**Not documented** for webhook delivery (no retry policy, ordering, or at-least-once guarantee stated). The **properties** endpoint returns 429 at **100 req/sec**.
**Decisions:**
- Treat webhooks as **at-least-once and possibly out of order** → idempotent handlers keyed by `event_type + ticket_id + status` (and raw event stored in `webhook_events`).
- Our own outbound calls: retry with exponential backoff on 429/5xx, never double-send (idempotency via `surveys.survey_message_id` + status guards).
- Send caps come from Best Practices (below), not an API limit.

---

## 3. Send flow mechanics (important)

`POST /v1/message/send` is **asynchronous**. Response:
```json
{ "status":"queued", "unique_id":"...", "queue_id":"...", "track_by":{"unique_id":"GET /messages/.../status"} }
```
No final message id returned immediately. **`unique_id` is our provisional/survey message id** — store it as `surveys.survey_message_id` and reconcile via `GET /message/{unique_id}/status`. The eventual message record reuses `unique_id`; `queue_id` surfaces as `sent_message_id`. `VERIFY` that an inbound reply's `quoted_message_id` equals this `unique_id`.

Private notes: `POST /v1/notes/create` with `{chat_id, message}`. **`@member@email.com` inside `message` creates a task** for that member; `mentioned_ids` returns the emails. `performed_by:"api"`, `is_private_note:true`. Supports `*bold*` / `_italic_`.

---

## 4. Best-practices → product rules (ban risk)

WhatsApp bans are the real constraint. Key numbers:
- **3–5 spam reports in a short window can trigger enforcement.** This is why the survey is opt-out-friendly, 1:1 only, cooldown-gated, and allowlisted in dev.
- Daily volume: low risk 5–20 msgs/day; medium 20–50; high 100+. New-chat caps: low 0–10/day.
- Main ban causes: spam complaints/blocks, messaging non-existent numbers, one-way blasting, identical content, sudden volume spikes, very new numbers, unauthorized tools.

**Product decisions driven by this:**
- Default **cooldown 7 days** per contact; **global cap ~20 surveys/hour** and a daily ceiling.
- **DRY_RUN=true** default; **ALLOWLIST_NUMBERS** gate in dev.
- Survey is a single short personalized message with a natural question; optional opt-out line configurable. No reminders (non-goal).
- Skip groups by default (also avoids mass-send + ambiguous score).

---

## 4b. Provenance: docs-sourced vs needs-verification

Everything in this doc is **sourced from the published docs** (fetched 2026-10-17) unless marked. The **mock Periskope server** (`/mock-periskope`) implements these shapes so the app can be built and demoed with no WhatsApp number — but the mock encodes the *documented* behaviour, so a passing mock does **not** discharge a `VERIFY`. These three in particular are docs-only guesses until checked against a real account:

| Detail | Docs say | Mock behaviour | Status |
|---|---|---|---|
| Ticket `status` values | `open`, `inprogress`, `closed`, `archived` | same set | **VERIFY** exact strings/casing on a real ticket |
| Poll vote → webhook | undocumented; `message.updated` only covers edits | mock does **not** emit a vote webhook | **VERIFY** — decides if poll mode is viable |
| Signature format | prose says raw body; sample uses `JSON.stringify(req.body)` | mock signs the **raw bytes** it sends (our `raw` variant) | **VERIFY** which form the real server uses + the "decrypted key" wording |

## 5. Open items to verify with real payloads (M1 checklist)
1. `ticket.updated`: is `chat` always populated? exact `status` string casing.
2. Customer reply shape: `from_me:false`, `performed_by:null`, how `is_internal` resolves via members.
3. `quoted_message_id` == our send `unique_id`?
4. Poll vote → any webhook? (decides poll mode)
5. Signature: raw vs stringify, and the "decrypted key" wording.
6. `performed_by` value for AI-agent-sent messages (stretch).
7. Exact paths/method names for get-property, get-chat, get-messages-in-chat (fill from OpenAPI spec; generate TS types from `openapi.json`).
8. Media reply message_type values (image/sticker/ptt/audio) → map to `unparseable_media`.

---

## 6. Discrepancies log (docs vs each other / vs reality)
- **Signature:** prose (raw body) vs sample (`JSON.stringify`) disagree. Handling in Q7. (Feedback for Periskope: pin down one.)
- **"Decrypted" signing key** wording vs sample using key directly — unclear.
- **SDK page** documents only `sendMessage`; other resources undocumented there → use OpenAPI/`fetch`.
- `chat_type` listed as `user`/`group` in Ticket object, but spec also mentions `business` — treat `user` OR `business` as 1:1-eligible, `group` as skip. `VERIFY`.
