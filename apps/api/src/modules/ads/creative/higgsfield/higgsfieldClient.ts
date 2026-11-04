/**
 * The Higgsfield REST client (ADS-AGENT-BUILD-WORKFLOW C3; plan D-AD13). Three calls and nothing else:
 * submit, status, and fetching an output file. The shapes are the ones `fakeHiggsfield.ts` documents, with
 * the docs pages it cites (read 2026-11-02); the base URL is ADS-AGENT-PLAN's research (2026-10-31). Both are
 * OUR reading until L4 re-runs this against the real API with the owner's key (Q-AD20).
 *
 * It holds no state, writes nothing and decides nothing: `render.ts` owns the ledger, the budget and the
 * storage copy. Every answer is a tagged outcome, never a throw for an HTTP status, so the caller can tell
 * the cases that matter apart:
 *   · `temporary` — 429 (with Retry-After), 5xx, a timeout, a dropped connection: the request may or may
 *     not exist; asked again with the SAME Idempotency-Key it is found, never made twice;
 *   · `balance`   — 403: the Higgsfield account cannot pay. Nothing was made;
 *   · `refused`   — any other 4xx (422 includes a key reused with different parameters: a bug of ours).
 */

export const HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";
const TIMEOUT_MS = 30_000;

export interface HiggsfieldKey { id: string; secret: string }

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HfRequestState {
  status: HfStatus;
  request_id: string;
  expires_at?: string;
  images?: Array<{ url: string; content_type?: string }>;
  video?: { url: string; content_type?: string };
  error?: string | null;
}

export type HfAnswer<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "temporary"; retryAfterSeconds: number | null; detail: string }
  | { ok: false; kind: "balance"; detail: string }
  | { ok: false; kind: "refused"; status: number; detail: string };

export class HiggsfieldClient {
  private readonly base: string;

  constructor(private readonly key: HiggsfieldKey, opts: { baseUrl?: string } = {}) {
    this.base = (opts.baseUrl ?? HIGGSFIELD_BASE_URL).replace(/\/$/, "");
  }

  /** POST /{model}. `idempotencyKey` is our generation id: a retry returns the original request, free. */
  submit(model: string, params: Record<string, unknown>, idempotencyKey: string): Promise<HfAnswer<{ request_id: string }>> {
    return this.call("POST", `/${model.replace(/^\//, "")}`, { "Idempotency-Key": idempotencyKey, "content-type": "application/json" }, JSON.stringify(params));
  }

  status(requestId: string): Promise<HfAnswer<HfRequestState>> {
    return this.call("GET", `/requests/${encodeURIComponent(requestId)}/status`, {}, undefined);
  }

  /** An output file's bytes. The URL is Higgsfield's and expires; it is read once and never stored. */
  async download(url: string): Promise<HfAnswer<Buffer>> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404 || res.status === 410) return { ok: false, kind: "refused", status: res.status, detail: "output file is gone" };
      if (!res.ok) return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: `file ${res.status}` };
      return { ok: true, value: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  private async call<T>(method: string, path: string, headers: Record<string, string>, body: string | undefined): Promise<HfAnswer<T>> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method, body, signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { ...headers, Authorization: `Key ${this.key.id}:${this.key.secret}`, accept: "application/json" },
      });
    } catch (e) {
      return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: e instanceof Error ? e.message : String(e) };
    }
    const text = await res.text();
    const json = (() => { try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; } })();
    const detail = json && "detail" in json ? JSON.stringify(json.detail) : `HTTP ${res.status}`;
    if (res.ok && json) return { ok: true, value: json as T };
    if (res.status === 429 || res.status >= 500 || (res.ok && !json)) {
      const after = Number(res.headers.get("retry-after"));
      return { ok: false, kind: "temporary", retryAfterSeconds: Number.isFinite(after) && after > 0 ? after : null, detail };
    }
    if (res.status === 403) return { ok: false, kind: "balance", detail };
    return { ok: false, kind: "refused", status: res.status, detail };
  }
}
