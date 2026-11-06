/**
 * The Higgsfield REST client (ADS-AGENT-BUILD-WORKFLOW C3; plan D-AD13). Four calls and nothing else:
 * submit, status, fetching an output file, and (D-AD9, 2026-11-04) uploading an input image. The shapes are the ones `fakeHiggsfield.ts` documents, with
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
 *
 * ── THE KEY NEVER LEAVES IN A `detail` (G-sec #2070 finding; fixed 2026-11-06, sec-fixes) ──────────
 * A failure's `detail` is Higgsfield's own words, and `render.ts` carries a temporary one into a pending
 * render's `why`, which the job's error keeps (`jobs.last_error`, the log). If the vendor ever echoes the
 * credentials it was sent, they would ride along. So every answer leaves through ONE scrub at this boundary
 * (`scrubbed`), which blanks the secret and the `id:secret` form, as `MetaGraph.scrub` does for its token. No
 * call site scrubs, so a new call cannot forget to.
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
    return this.scrubbed(this.call("POST", `/${model.replace(/^\//, "")}`, { "Idempotency-Key": idempotencyKey, "content-type": "application/json" }, JSON.stringify(params)));
  }

  /**
   * An input image, uploaded the two-step way `fakeHiggsfield.ts` cites (file-uploads.md, read 2026-11-04):
   * ask for a presigned URL for this content type, then PUT the bytes there with EVERY header it returned —
   * and without our credentials, which the docs say never go to the storage URL. The answer is the
   * `public_url` a model's image field takes. Uploads are not idempotent (idempotency.md): `render.ts`
   * makes sure one is done once per render, by writing its URL on the ledger row before the submit.
   */
  upload(bytes: Buffer, contentType: string): Promise<HfAnswer<{ public_url: string }>> {
    return this.scrubbed(this.uploadOnce(bytes, contentType));
  }

  private async uploadOnce(bytes: Buffer, contentType: string): Promise<HfAnswer<{ public_url: string }>> {
    const made = await this.call<{ public_url?: unknown; upload_url?: unknown; upload_headers?: unknown }>(
      "POST", "/files/generate-upload-url", { "content-type": "application/json" }, JSON.stringify({ content_type: contentType }),
    );
    if (!made.ok) return made;
    const { public_url, upload_url, upload_headers } = made.value;
    if (typeof public_url !== "string" || typeof upload_url !== "string") return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: "upload url answer without its URLs" };
    // Exactly the headers it signed — a Content-Type of our own beside theirs would be sent twice, joined.
    const signed = Object.entries((upload_headers ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)] as [string, string]);
    const headers = signed.some(([k]) => k.toLowerCase() === "content-type") ? signed : [...signed, ["content-type", contentType] as [string, string]];
    try {
      const res = await fetch(upload_url, { method: "PUT", headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return res.status >= 500 || res.status === 429 || res.status === 403
        // 403 from a presigned URL is one that expired (an hour, the docs say): a fresh one fixes it.
        ? { ok: false, kind: "temporary", retryAfterSeconds: null, detail: `upload ${res.status}` }
        : { ok: false, kind: "refused", status: res.status, detail: `upload ${res.status}` };
    } catch (e) {
      return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: e instanceof Error ? e.message : String(e) };
    }
    return { ok: true, value: { public_url } };
  }

  status(requestId: string): Promise<HfAnswer<HfRequestState>> {
    return this.scrubbed(this.call("GET", `/requests/${encodeURIComponent(requestId)}/status`, {}, undefined));
  }

  /** An output file's bytes. The URL is Higgsfield's and expires; it is read once and never stored. */
  download(url: string): Promise<HfAnswer<Buffer>> {
    return this.scrubbed(this.downloadOnce(url));
  }

  private async downloadOnce(url: string): Promise<HfAnswer<Buffer>> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 404 || res.status === 410) return { ok: false, kind: "refused", status: res.status, detail: "output file is gone" };
      if (!res.ok) return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: `file ${res.status}` };
      return { ok: true, value: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      return { ok: false, kind: "temporary", retryAfterSeconds: null, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  /** The one exit: a failure's `detail` with the key blanked. A success carries nothing of ours to scrub. */
  private async scrubbed<T>(answer: Promise<HfAnswer<T>>): Promise<HfAnswer<T>> {
    const a = await answer;
    return a.ok ? a : { ...a, detail: this.scrub(a.detail) };
  }

  /** The `id:secret` pair first, then the secret alone (a vendor may quote either). */
  private scrub(s: string): string {
    return s.split(`${this.key.id}:${this.key.secret}`).join("[key]").split(this.key.secret).join("[key]");
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
