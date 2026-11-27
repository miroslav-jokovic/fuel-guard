/**
 * Sends the requests `graphCalls.ts` built, and turns Graph's answers into the four outcomes the
 * cycle acts on (§7): a page, a refused mailbox, a full mailbox, or "slow down".
 *
 * This file can only GET. It has no method parameter and no body, so even a URL that slipped past
 * the allowlist could not send, move or delete anything. The token comes from `token.ts`; a 401 asks
 * for a fresh one exactly once, because a token that expired mid-cycle is normal and a second 401 is
 * not.
 */

export type GraphPage = { value: Record<string, unknown>[]; nextLink: string | null; deltaLink: string | null };

/** The mailbox refused us (403) or does not exist (404): a mailbox state, not a failure (D-BMR14). */
export class MailboxRefused extends Error {
  constructor(readonly status: number) { super(`mailbox refused (${status})`); this.name = "MailboxRefused"; }
}
/** `ErrorQuotaExceeded` (V5): a full mailbox is its state, not the gateway's error. */
export class MailboxOverQuota extends Error {
  constructor() { super("mailbox over quota"); this.name = "MailboxOverQuota"; }
}
/** 429/503: skip this mailbox for this cycle and count it; the next minute retries (§7). */
export class GraphThrottled extends Error {
  constructor(readonly retryAfterSeconds: number) { super("graph throttled"); this.name = "GraphThrottled"; }
}
/** The delta link expired or was reset (410 / `SyncStateNotFound`): forget the cursor and start over. */
export class CursorReset extends Error {
  constructor() { super("delta cursor reset"); this.name = "CursorReset"; }
}
export class GraphFailed extends Error {
  constructor(readonly status: number, readonly code: string | null) { super(`graph ${status} ${code ?? ""}`.trim()); this.name = "GraphFailed"; }
}

export interface TokenSource {
  /** A Graph token; `fresh` forces a new one (after a 401). */
  get(fresh?: boolean): Promise<string>;
}

export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface GraphGet {
  page(url: string): Promise<GraphPage>;
  /** Shape 3: the message body as plain text, or null when there is none. */
  body(url: string): Promise<string | null>;
  /** Shape 4: the HTTP status alone. Never throws for 403/404 — they ARE the answer. */
  probe(url: string): Promise<number>;
  /** Shape 4 on a derived mailbox: the Inbox's id, which its subfolders name as their parent. */
  inboxId(url: string): Promise<string>;
}

export function graphGet(fetch: Fetch, tokens: TokenSource): GraphGet {
  async function send(url: string, headers: Record<string, string> = {}) {
    let res = await fetch(url, { headers: { authorization: `Bearer ${await tokens.get()}`, ...headers } });
    if (res.status === 401) res = await fetch(url, { headers: { authorization: `Bearer ${await tokens.get(true)}`, ...headers } });
    return res;
  }
  async function ok(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await send(url, headers);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300) return json;
    const code = ((json.error as { code?: string } | undefined)?.code) ?? null;
    if (res.status === 429 || res.status === 503) {
      throw new GraphThrottled(Math.min(Number(res.headers.get("retry-after")) || 60, 3600));
    }
    if (code === "ErrorQuotaExceeded") throw new MailboxOverQuota();
    if (res.status === 410 || code === "SyncStateNotFound" || code === "SyncStateInvalid") throw new CursorReset();
    if (res.status === 403 || res.status === 404) throw new MailboxRefused(res.status);
    throw new GraphFailed(res.status, code);
  }
  return {
    async page(url) {
      // Graph's documented page-size header; 50 keeps one page well inside a cycle's time.
      const json = await ok(url, { prefer: "odata.maxpagesize=50" });
      return {
        value: Array.isArray(json.value) ? (json.value as Record<string, unknown>[]) : [],
        nextLink: typeof json["@odata.nextLink"] === "string" ? (json["@odata.nextLink"] as string) : null,
        deltaLink: typeof json["@odata.deltaLink"] === "string" ? (json["@odata.deltaLink"] as string) : null,
      };
    },
    async body(url) {
      const json = await ok(url, { prefer: 'outlook.body-content-type="text"' });
      const content = (json.body as { content?: unknown } | undefined)?.content;
      return typeof content === "string" ? content : null;
    },
    async probe(url) {
      const res = await send(url);
      return res.status;
    },
    async inboxId(url) {
      const json = await ok(url);
      if (typeof json.id !== "string") throw new GraphFailed(200, "NoInboxId");
      return json.id;
    },
  };
}
