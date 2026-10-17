# Mock Periskope server

Develop and demo the whole CSAT flow with **no WhatsApp number connected**.

It implements the REST endpoints the app calls (documented shapes from the
Periskope OpenAPI spec), enforces the same auth headers (`Authorization: Bearer`,
`x-phone`), keeps state in memory, and fires **HMAC-signed webhooks** at the app
exactly as the real server would.

> The mock encodes the *documented* behaviour. A passing mock does **not**
> replace verifying against a real account — see `docs/RESEARCH.md §4b` for the
> three details still marked VERIFY (status strings, poll-vote webhooks, signature form).

## Run

```bash
npm install
# one terminal: the app  (needs DATABASE_URL + `npm run db:push` once)
npm run dev
# another terminal: the mock
npm run mock
# or both at once:
npm run dev:all
```

Then open the control panel: **http://localhost:4010**

Point the app at the mock (`.env.local`), env-only, no code change:

```
PERISKOPE_BASE_URL=http://localhost:4010
PERISKOPE_SIGNING_SECRET=dev-signing-secret   # app + mock must share this
DRY_RUN=false                                 # safe: sends hit the mock, not WhatsApp
```

## Control panel buttons

- **Close ticket** → fires `ticket.updated` with `status: closed`.
- **Reopen ticket** → fires `ticket.updated` with `status: open`.
- **Customer replies…** → free-text box fires `message.created` (`from_me:false`,
  `performed_by:null`); tick *quote survey* to set `quoted_message_id` to the last
  sent survey (the high-confidence match path).
- **Send duplicate webhook** → re-POSTs the last webhook's exact bytes, to prove
  idempotency (same `dedupe_key` → collapsed).

## Endpoints implemented

`POST /message/send` · `POST /notes/create` · `GET /tickets/:id` ·
`PATCH /tickets/:id` · `POST /properties/create` · `GET /properties` ·
`GET /chat/:id` · `GET /chat/:id/messages` · `GET /message/:id/status`
(each also under `/v1/...`).

Seeded on boot: chat `919111111111@c.us` (Asha Verma, 1:1) + ticket `TCK-1001`
(open, assignee `rahul@support.dev`).
