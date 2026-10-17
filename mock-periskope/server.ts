import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Mock Periskope server.
 *
 * Lets the whole CSAT app be developed and demoed with no real WhatsApp number.
 * It implements the REST endpoints our app calls (matching the documented
 * request/response shapes), enforces the same auth headers, and fires
 * HMAC-signed webhooks at our app so the entire flow can be acted out by hand
 * from the control panel at http://localhost:4010.
 *
 * Switching app <-> mock is env-only: set PERISKOPE_BASE_URL=http://localhost:4010.
 *
 * Shapes here follow docs/RESEARCH.md. Anything the docs left ambiguous is the
 * mock's best guess and is flagged in RESEARCH.md §5 as needing real-account
 * verification (status values, poll-vote webhooks, signature format).
 */

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const API_KEY = process.env.PERISKOPE_API_KEY ?? '';
const SIGNING_SECRET = process.env.PERISKOPE_SIGNING_SECRET ?? 'dev-signing-secret';
const WEBHOOK_TARGET =
  process.env.MOCK_WEBHOOK_TARGET ??
  `${(process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/api/webhooks/periskope`;

const ORG_ID = 'org_mock_1';
const ORG_PHONE = `${(process.env.PERISKOPE_PHONE ?? '919000000000').replace(/\D/g, '')}@c.us`;

// ---- In-memory state --------------------------------------------------

type Member = {
  org_id: string;
  chat_id: string;
  is_admin: boolean;
  org_phone: string;
  contact_id: string;
  is_internal: boolean;
  contact_name: string;
  contact_color: string;
  contact_image: string | null;
  is_super_admin: boolean;
};

type Ticket = {
  org_id: string;
  ticket_id: string;
  subject: string;
  status: 'open' | 'inprogress' | 'closed' | 'archived';
  assignee: string;
  assigned_by: string;
  raised_by: string;
  due_date: string;
  priority: number;
  closed_at: string | null;
  closed_by: string | null;
  closed_message: string | null;
  ticket_labels: string;
  quoted_message_id: string | null;
  ticket_custom_properties: Record<string, string>;
  created_at: string;
  first_assigned_at: string | null;
  is_deleted: boolean;
  chat_id: string; // internal link, not sent at ticket root (docs: ticket has no chat_id)
};

type MockMessage = {
  message_id: string;
  unique_id: string;
  chat_id: string;
  org_phone: string;
  from_me: boolean;
  body: string;
  message_type: string;
  performed_by: string | null;
  sender_phone: string;
  quoted_message_id: string | null;
  has_quoted_msg: boolean;
  timestamp: string;
  ack: string;
};

type PropertyOption = { id: string; label: string };
type Property = {
  property_id: string;
  property_name: string;
  type: 'ticket' | 'chat';
  kind: 'text' | 'date' | 'dropdown' | 'picklist' | 'file';
  mandatory: boolean;
  section_id: string;
  section_name: string;
  options?: PropertyOption[];
  created_at: string;
};

const state = {
  chats: new Map<string, any>(),
  tickets: new Map<string, Ticket>(),
  messages: new Map<string, MockMessage[]>(), // chat_id -> messages
  properties: [] as Property[],
  lastSurveyMessageId: new Map<string, string>(), // chat_id -> last outbound message id
  lastWebhookBody: null as string | null, // raw bytes of the last fired webhook (for duplicate)
  log: [] as Array<{ at: string; line: string }>,
};

function logLine(line: string) {
  state.log.unshift({ at: new Date().toISOString(), line });
  if (state.log.length > 50) state.log.pop();
  console.log(`[mock] ${line}`);
}

// ---- Seed -------------------------------------------------------------

const CUSTOMER_CONTACT = 'contact_cust_1';
const CUSTOMER_PHONE = '919111111111@c.us';
const AGENT_EMAIL = 'rahul@support.dev';

function seed() {
  const chatId = CUSTOMER_PHONE;
  const members: Record<string, Member> = {
    [CUSTOMER_CONTACT]: {
      org_id: ORG_ID,
      chat_id: chatId,
      is_admin: false,
      org_phone: ORG_PHONE,
      contact_id: CUSTOMER_CONTACT,
      is_internal: false,
      contact_name: 'Asha Verma',
      contact_color: '#4f46e5',
      contact_image: null,
      is_super_admin: false,
    },
  };
  state.chats.set(chatId, {
    org_id: ORG_ID,
    org_phone: ORG_PHONE,
    chat_id: chatId,
    members,
    is_muted: false,
    chat_name: 'Asha Verma',
    chat_type: 'user', // 1:1, CSAT-eligible
    chat_image: null,
    created_at: new Date().toISOString(),
    chat_labels: '',
    invite_link: null,
    custom_properties: {},
    group_description: null,
  });

  const now = new Date().toISOString();
  state.tickets.set('TCK-1001', {
    org_id: ORG_ID,
    ticket_id: 'TCK-1001',
    subject: 'Cannot download invoice',
    status: 'open',
    assignee: AGENT_EMAIL,
    assigned_by: AGENT_EMAIL,
    raised_by: 'api',
    due_date: '',
    priority: 2,
    closed_at: null,
    closed_by: null,
    closed_message: null,
    ticket_labels: '',
    quoted_message_id: null,
    ticket_custom_properties: {},
    created_at: now,
    first_assigned_at: now,
    is_deleted: false,
    chat_id: chatId,
  });

  state.messages.set(chatId, []);
  logLine('seeded chat 919111111111@c.us + ticket TCK-1001 (open)');
}

// ---- Payload builders (mirror RESEARCH.md shapes) ---------------------

function chatPayload(chatId: string) {
  return state.chats.get(chatId) ?? null;
}

function ticketPayload(t: Ticket) {
  // Note: docs say the ticket object has NO chat_id at its root; chat_id lives
  // under data.chat. We keep t.chat_id internal only.
  const { chat_id, ...rest } = t;
  void chat_id;
  return rest;
}

function ticketEnvelope(t: Ticket, eventType: 'ticket.created' | 'ticket.updated') {
  return {
    event_type: eventType,
    org_id: ORG_ID,
    timestamp: new Date().toISOString(),
    data: {
      chat: chatPayload(t.chat_id),
      message: {},
      ticket: ticketPayload(t),
      attached_messages: [],
    },
  };
}

function messageEnvelope(m: MockMessage) {
  // message.created puts the message object at data root (RESEARCH.md).
  return {
    event_type: 'message.created',
    org_id: ORG_ID,
    timestamp: new Date().toISOString(),
    data: { ...m },
  };
}

// ---- Fire a signed webhook at our app ---------------------------------

async function fireWebhook(payload: unknown): Promise<{ status: number; text: string }> {
  const body = JSON.stringify(payload);
  state.lastWebhookBody = body;
  const signature = createHmac('sha256', SIGNING_SECRET).update(body).digest('hex');
  try {
    const res = await fetch(WEBHOOK_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-periskope-signature': signature },
      body,
    });
    const text = await res.text();
    logLine(`webhook ${(payload as any).event_type} -> ${res.status} ${text.slice(0, 80)}`);
    return { status: res.status, text };
  } catch (err) {
    logLine(`webhook POST failed: ${String(err)} (is the app running on ${WEBHOOK_TARGET}?)`);
    return { status: 0, text: String(err) };
  }
}

// ---- Express app ------------------------------------------------------

const app = express();
app.use(express.json());

// Auth middleware for the REST API routes only (not control panel / webhooks).
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('authorization') ?? '';
  const phone = req.header('x-phone') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ code: 'unauthorized', message: 'Missing Bearer token', status: 401 });
  }
  const token = auth.slice('Bearer '.length).trim();
  if (API_KEY && token !== API_KEY) {
    return res.status(401).json({ code: 'unauthorized', message: 'Invalid API key', status: 401 });
  }
  // x-phone is required for send; we require it across the board to exercise auth.
  if (!phone) {
    return res.status(401).json({ code: 'unauthorized', message: 'Missing x-phone header', status: 401 });
  }
  next();
}

const api = express.Router();
api.use(requireAuth);

// POST /message/send  (async: returns a provisional unique_id)
api.post('/message/send', (req, res) => {
  const { chat_id, message, poll, reply_to } = req.body ?? {};
  if (!chat_id) return res.status(422).json({ code: 'validation', message: 'chat_id required', status: 422 });
  const uniqueId = `AAAA${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const msg: MockMessage = {
    message_id: `true_${chat_id}_${uniqueId}_${ORG_PHONE}`,
    unique_id: uniqueId,
    chat_id,
    org_phone: ORG_PHONE,
    from_me: true,
    body: message ?? (poll ? `[poll] ${poll.pollName}` : ''),
    message_type: poll ? 'poll_creation' : 'chat',
    performed_by: 'api',
    sender_phone: ORG_PHONE,
    quoted_message_id: reply_to ?? null,
    has_quoted_msg: Boolean(reply_to),
    timestamp: new Date().toISOString(),
    ack: '1',
  };
  const arr = state.messages.get(chat_id) ?? [];
  arr.push(msg);
  state.messages.set(chat_id, arr);
  state.lastSurveyMessageId.set(chat_id, uniqueId);
  logLine(`send -> ${chat_id}: ${JSON.stringify(message ?? poll).slice(0, 60)} (unique_id ${uniqueId})`);
  res.json({
    status: 'queued',
    unique_id: uniqueId,
    queue_id: `q_${uniqueId}`,
    queue_position: 0,
    track_by: { unique_id: `GET /messages/${uniqueId}/status` },
  });
});

// POST /notes/create  (@email mentions become tasks)
api.post('/notes/create', (req, res) => {
  const { chat_id, message, reply_to } = req.body ?? {};
  if (!chat_id || !message)
    return res.status(422).json({ code: 'validation', message: 'chat_id and message required', status: 422 });
  const mentioned = [...String(message).matchAll(/@([^\s@]+@[^\s@]+\.[^\s@]+)/g)].map((m) => m[1]);
  const id = `true_${chat_id}_${Date.now()}_api`;
  logLine(`note -> ${chat_id}: "${String(message).slice(0, 60)}" mentions=[${mentioned.join(', ')}]`);
  res.json({
    success: true,
    message: 'A Private note created successfully',
    data: {
      message_id: id,
      org_id: ORG_ID,
      org_phone: ORG_PHONE,
      chat_id,
      body: message,
      message_type: 'chat',
      media: null,
      is_private_note: true,
      from_me: true,
      performed_by: 'api',
      quoted_message_id: reply_to ?? id,
      mentioned_ids: mentioned,
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
});

// GET /tickets/:id
api.get('/tickets/:id', (req, res) => {
  const t = state.tickets.get(req.params.id);
  if (!t) return res.status(404).json({ code: 'not_found', message: 'ticket not found', status: 404 });
  res.json({
    chat: chatPayload(t.chat_id),
    message: {
      message_id: null,
      chat_id: t.chat_id,
      org_phone: ORG_PHONE,
      timestamp: null,
      body: '',
      media_path: '',
      sender_phone: '',
      sender_name: '',
      performed_by: null,
    },
    ticket: ticketPayload(t),
    attached_messages: [],
  });
});

// PATCH /tickets/:id  (status, assignee, custom_properties, labels, subject)
api.patch('/tickets/:id', (req, res) => {
  const t = state.tickets.get(req.params.id);
  if (!t) return res.status(404).json({ code: 'not_found', message: 'ticket not found', status: 404 });
  const b = req.body ?? {};
  if (b.status) t.status = b.status;
  if (b.status === 'closed') {
    t.closed_at = new Date().toISOString();
    t.closed_by = b.closed_by ?? 'api';
    t.closed_message = b.closed_message ?? null;
  }
  if (b.assignee !== undefined) t.assignee = b.assignee ?? '';
  if (b.subject !== undefined) t.subject = b.subject;
  if (b.labels !== undefined) t.ticket_labels = Array.isArray(b.labels) ? b.labels.join(', ') : String(b.labels);
  if (b.custom_properties && typeof b.custom_properties === 'object') {
    for (const [k, v] of Object.entries(b.custom_properties)) {
      // Resolve a dropdown option id back to its label for display, like the real API.
      const prop = state.properties.find(
        (p) => p.property_name.toLowerCase() === k.toLowerCase() || p.property_id === k,
      );
      let display = v == null ? '' : String(v);
      if (prop?.options) {
        const opt = prop.options.find((o) => o.id === String(v) || o.label === String(v));
        if (opt) display = opt.label;
      }
      t.ticket_custom_properties[prop?.property_name ?? k] = display;
    }
  }
  logLine(`PATCH ${t.ticket_id}: ${JSON.stringify(b).slice(0, 100)}`);
  res.json({ chat: chatPayload(t.chat_id), message: {}, ticket: ticketPayload(t), attached_messages: [] });
});

// POST /properties/create
api.post('/properties/create', (req, res) => {
  const { name, type, kind, section, options, mandatory } = req.body ?? {};
  if (!name || !type || !kind)
    return res.status(422).json({ code: 'validation', message: 'name, type, kind required', status: 422 });
  const exists = state.properties.find(
    (p) => p.type === type && p.property_name.toLowerCase() === String(name).toLowerCase(),
  );
  if (exists)
    return res.status(409).json({ code: 'conflict', message: 'property already exists', status: 409 });

  const needsOptions = kind === 'dropdown' || kind === 'picklist';
  const base = Date.now();
  const prop: Property = {
    property_id: `property-${Math.random().toString(36).slice(2, 14)}`,
    property_name: name,
    type,
    kind,
    mandatory: Boolean(mandatory),
    section_id: '00000000-0000-0000-0000-000000000000',
    section_name: section ?? 'General',
    created_at: new Date().toISOString(),
    ...(needsOptions
      ? { options: (options ?? []).map((label: string, i: number) => ({ id: String(base + i), label })) }
      : {}),
  };
  state.properties.push(prop);
  logLine(`property created: ${name} (${kind}) id=${prop.property_id}`);
  res.json({ success: true, message: 'Custom property created', data: prop });
});

// GET /properties
api.get('/properties', (req, res) => {
  const type = req.query.type as string | undefined;
  const data = type ? state.properties.filter((p) => p.type === type) : state.properties;
  res.json({ success: true, data });
});

// GET /chat/:id  (and /chats/:id alias)
api.get(['/chat/:id', '/chats/:id'], (req, res) => {
  const c = chatPayload(req.params.id);
  if (!c) return res.status(404).json({ code: 'not_found', message: 'chat not found', status: 404 });
  res.json(c);
});

// GET /chat/:id/messages  (and /chats/:id/messages)
api.get(['/chat/:id/messages', '/chats/:id/messages'], (req, res) => {
  res.json({ success: true, data: state.messages.get(req.params.id) ?? [] });
});

// GET /message/:id/status
api.get('/message/:id/status', (req, res) => {
  const id = req.params.id;
  res.json({
    unique_id: id,
    status: 'delivered',
    ack: '2',
    delivery_info: { delivered: { [CUSTOMER_PHONE]: Date.now() }, read: {}, delivered_count: 1, read_count: 0 },
  });
});

// Mount the API under /v1 now; the catch-all '/' mount is registered LAST
// (after the control routes) so control + panel paths are matched first and
// don't hit the API's auth middleware.
app.use('/v1', api);

// ---- Control panel ----------------------------------------------------

const PANEL_HTML = readFileSync(join(__dirname, 'panel.html'), 'utf8');
app.get('/', (_req, res) => res.type('html').send(PANEL_HTML));

app.get('/control/state', (_req, res) => {
  const t = state.tickets.get('TCK-1001');
  res.json({
    ticket: t ? { ticket_id: t.ticket_id, subject: t.subject, status: t.status, assignee: t.assignee, custom: t.ticket_custom_properties } : null,
    webhookTarget: WEBHOOK_TARGET,
    properties: state.properties.map((p) => ({ name: p.property_name, kind: p.kind })),
    log: state.log,
  });
});

app.post('/control/close', async (_req, res) => {
  const t = state.tickets.get('TCK-1001');
  if (!t) return res.status(404).json({ error: 'no ticket' });
  t.status = 'closed';
  t.closed_at = new Date().toISOString();
  t.closed_by = AGENT_EMAIL;
  const r = await fireWebhook(ticketEnvelope(t, 'ticket.updated'));
  res.json({ fired: 'ticket.updated(closed)', ...r });
});

app.post('/control/reopen', async (_req, res) => {
  const t = state.tickets.get('TCK-1001');
  if (!t) return res.status(404).json({ error: 'no ticket' });
  t.status = 'open';
  t.closed_at = null;
  t.closed_by = null;
  const r = await fireWebhook(ticketEnvelope(t, 'ticket.updated'));
  res.json({ fired: 'ticket.updated(open)', ...r });
});

app.post('/control/reply', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  const quote = Boolean(req.body?.quote);
  const chatId = CUSTOMER_PHONE;
  const uniqueId = `IN${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const quotedId = quote ? state.lastSurveyMessageId.get(chatId) ?? null : null;
  const msg: MockMessage = {
    message_id: `false_${chatId}_${uniqueId}_${chatId}`,
    unique_id: uniqueId,
    chat_id: chatId,
    org_phone: ORG_PHONE,
    from_me: false, // inbound customer message (RESEARCH.md Q4)
    body: text,
    message_type: 'chat',
    performed_by: null, // received from WhatsApp (RESEARCH.md Q4)
    sender_phone: chatId,
    quoted_message_id: quotedId,
    has_quoted_msg: Boolean(quotedId),
    timestamp: new Date().toISOString(),
    ack: '2',
  };
  const arr = state.messages.get(chatId) ?? [];
  arr.push(msg);
  state.messages.set(chatId, arr);
  const r = await fireWebhook(messageEnvelope(msg));
  res.json({ fired: `message.created${quotedId ? ' (quoting survey)' : ''}`, ...r });
});

app.post('/control/duplicate', async (_req, res) => {
  if (!state.lastWebhookBody) return res.status(400).json({ error: 'no previous webhook to duplicate' });
  const signature = createHmac('sha256', SIGNING_SECRET).update(state.lastWebhookBody).digest('hex');
  try {
    const resp = await fetch(WEBHOOK_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-periskope-signature': signature },
      body: state.lastWebhookBody,
    });
    const text = await resp.text();
    logLine(`duplicate webhook -> ${resp.status} ${text.slice(0, 80)}`);
    res.json({ fired: 'duplicate', status: resp.status, text });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// Catch-all API mount LAST so unprefixed calls (PERISKOPE_BASE_URL without /v1)
// work, without shadowing the control routes above.
app.use('/', api);

seed();
app.listen(PORT, () => {
  console.log(`[mock] Periskope mock on http://localhost:${PORT}`);
  console.log(`[mock] control panel: http://localhost:${PORT}`);
  console.log(`[mock] webhooks -> ${WEBHOOK_TARGET}`);
  console.log(`[mock] set PERISKOPE_BASE_URL=http://localhost:${PORT} in the app's .env.local`);
});
