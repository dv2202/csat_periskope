/**
 * Thin, centralized wrapper over the Periskope REST API.
 *
 * Why typed fetch and not the SDK: the SDK docs only document sendMessage;
 * tickets / properties / notes methods are undocumented there (RESEARCH.md §1).
 * A small fetch layer lets us hit every endpoint with one place for headers,
 * retries, DRY_RUN rails and logging. We can swap to the SDK later per-method.
 */

const BASE_URL = process.env.PERISKOPE_BASE_URL ?? 'https://api.periskope.app/v1';

export class PeriskopeError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'PeriskopeError';
  }
}

function dryRun(): boolean {
  return process.env.DRY_RUN !== 'false';
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${process.env.PERISKOPE_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };
  const phone = process.env.PERISKOPE_PHONE;
  if (phone) h['x-phone'] = phone;
  return { ...h, ...extra };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  { retries = 3 }: { retries?: number } = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      if (attempt <= retries) {
        await backoff(attempt);
        continue;
      }
      throw new PeriskopeError(`Network error calling ${method} ${path}: ${String(err)}`, 0, null);
    }

    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    }

    if (RETRYABLE.has(res.status) && attempt <= retries) {
      await backoff(attempt, res.headers.get('retry-after'));
      continue;
    }

    const errBody = await safeJson(res);
    throw new PeriskopeError(
      `Periskope ${method} ${path} failed: ${res.status}`,
      res.status,
      errBody,
    );
  }
}

async function backoff(attempt: number, retryAfter?: string | null) {
  const headerMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  const expMs = Math.min(1000 * 2 ** (attempt - 1), 8000);
  const jitter = Math.random() * 250;
  await new Promise((r) => setTimeout(r, Math.max(headerMs, expMs) + jitter));
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Types (minimal, extend as needed) --------------------------------

export type SendMessageInput = {
  chat_id: string;
  message?: string;
  reply_to?: string;
  poll?: {
    pollName: string;
    pollOptions: string[];
    options?: { allowMultipleAnswers?: boolean; pollId?: string };
  };
};

export type SendMessageResult = {
  status: string;
  unique_id: string;
  queue_id?: string;
};

export type CreatePropertyInput = {
  name: string;
  type: 'ticket' | 'chat';
  kind: 'text' | 'date' | 'dropdown' | 'picklist' | 'file';
  section?: string;
  options?: string[];
  mandatory?: boolean;
};

export type PropertyOption = { id: string; label: string };
export type CreatePropertyResult = {
  success: boolean;
  data: {
    property_id: string;
    property_name: string;
    type: string;
    kind: string;
    options?: PropertyOption[];
  };
};

// ---- Client -----------------------------------------------------------

export const periskope = {
  /** Send a WhatsApp message. Async on Periskope's side: returns a unique_id. */
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (dryRun()) {
      const fake = `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      console.log('[DRY_RUN] sendMessage', JSON.stringify(input));
      return { status: 'dry_run', unique_id: fake };
    }
    return request<SendMessageResult>('POST', '/message/send', input);
  },

  /** Create a private note. @member@email mentions become tasks. */
  async createNote(input: { chat_id: string; message: string; reply_to?: string }): Promise<unknown> {
    if (dryRun()) {
      console.log('[DRY_RUN] createNote', JSON.stringify(input));
      return { success: true, dry_run: true };
    }
    return request('POST', '/notes/create', input);
  },

  async getTicket(ticketId: string): Promise<any> {
    return request('GET', `/tickets/${encodeURIComponent(ticketId)}`);
  },

  async updateTicket(
    ticketId: string,
    body: {
      status?: 'open' | 'inprogress' | 'closed' | 'archived';
      assignee?: string | null;
      closed_by?: string;
      closed_message?: string;
      custom_properties?: Record<string, unknown>;
      labels?: string[];
      subject?: string;
    },
  ): Promise<any> {
    // Write-back (custom properties) is a real mutation but not a WhatsApp send,
    // so DRY_RUN does not block it. We still log in dry mode for traceability.
    if (dryRun()) {
      console.log('[DRY_RUN] updateTicket', ticketId, JSON.stringify(body));
    }
    return request('PATCH', `/tickets/${encodeURIComponent(ticketId)}`, body);
  },

  async createProperty(input: CreatePropertyInput): Promise<CreatePropertyResult> {
    return request<CreatePropertyResult>('POST', '/properties/create', input);
  },

  /** List custom properties. Path/shape to confirm against OpenAPI (RESEARCH.md §1). */
  async listProperties(type?: 'ticket' | 'chat'): Promise<any> {
    const q = type ? `?type=${type}` : '';
    return request('GET', `/properties${q}`);
  },

  async getMessageStatus(uniqueId: string): Promise<any> {
    return request('GET', `/message/${encodeURIComponent(uniqueId)}/status`);
  },
};
