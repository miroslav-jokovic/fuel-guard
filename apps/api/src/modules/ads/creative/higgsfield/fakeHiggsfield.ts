import { createHmac, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * FakeHiggsfield — an in-process `node:http` Higgsfield API (ADS-AGENT-BUILD-WORKFLOW.md §4R, "The
 * harness") for the renderer's client (C3) and the simulator on a positively non-production host
 * (`platforms/simulatorGate.ts`). Like FakeMeta, it lives beside the code that will call it, not under
 * `testing/`, because staging runs it.
 *
 * ── WHAT IT IMPLEMENTS, AND WHERE EACH SHAPE IS FROM (read 2026-11-02) ───────────────────────────
 *   Auth: `Authorization: Key <key-id>:<key-secret>` on every call; else 401 `{ detail }`.
 *       https://docs.higgsfield.ai/docs/api-reference/headers.md
 *   POST /{model path}  (JSON) → `{ status: "queued", request_id, status_url, cancel_url, expires_after }`.
 *       `Idempotency-Key` (1–255 visible ASCII): "Retrying with the same key returns the original
 *       request instead of creating a new one"; the same key with different parameters is 422.
 *       `hf_webhook` (query) = where the result is POSTed when the request finishes.
 *       https://docs.higgsfield.ai/docs/concepts/requests.md
 *   GET  /requests/{id}/status → the request; `completed` carries `expires_at` and `images[{url}]` or
 *       `video{url}`; `failed` carries `error`; `nsfw` neither.
 *   POST /requests/{id}/cancel → only while `queued`; `in_progress` cannot be canceled (409).
 *   Webhook (Standard Webhooks): headers `webhook-id` (same across retries of one event),
 *       `webhook-timestamp` (unix seconds), `webhook-signature` = `v1,<base64 HMAC-SHA256 of
 *       "{id}.{timestamp}.{raw body}">`, key = base64-decoded secret after `whsec_`. Body
 *       `{ request_id, status, error, payload }`, `payload.images[{url, content_type}]` / `payload.video`;
 *       sent only on completed, failed or nsfw. https://docs.higgsfield.ai/docs/how-to/webhooks.md
 *   Errors: FastAPI's `{ detail }`; 403 insufficient balance, 404 unknown, 409 still running, 422
 *       validation / key reuse, 429 queue full with `Retry-After` seconds, 500, 503; every response
 *       carries `X-Correlation-ID`. https://docs.higgsfield.ai/docs/concepts/errors.md
 *   Billing: "Requests ending as `failed` or `nsfw` are not charged"; a canceled queued request is
 *       refunded. https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md
 *
 * ⚠ OUR READING, NOT THEIRS: the docs do not say whether the balance is debited at submit or at
 * completion, nor the body of a 403. This fake RESERVES the price at submit (refusing with 403 when the
 * balance cannot cover it) and refunds on failed / nsfw / cancel — the reading under which "a replayed
 * submit charges twice" is a bug a test can see. The price per model is ours to configure; the real
 * prices are V4's measurement (needs G2). L4 re-runs the contract suite against the real API.
 *
 * Requests do not finish on their own: a test (or the simulator's driver) calls `finish(...)`, so a
 * scenario decides when — and whether — a render ends, and whether its webhook arrives.
 */

export type HiggsfieldStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface FakeHiggsfieldRequest {
  request_id: string;
  model: string;
  params: string;
  idempotency_key: string | null;
  webhook: string | null;
  status: HiggsfieldStatus;
  price_cents: number;
  output: { images?: Array<{ url: string; content_type: string }>; video?: { url: string; content_type: string } } | null;
  error: string | null;
  expires_at: string | null;
}

export type FakeHiggsfieldFault =
  | { kind: "queue_full"; retryAfterSeconds?: number }
  | { kind: "server_error" }
  | { kind: "unavailable" }
  | { kind: "hang" }
  /** The submit is accepted and charged, then the answer is a 500 — the caller must replay with its key. */
  | { kind: "accepted_then_error" };

export interface FakeHiggsfieldOptions {
  keyId: string;
  keySecret: string;
  /** `whsec_` + base64, as the console reveals it. */
  webhookSecret: string;
  balanceCents: number;
  /** Price of one request per model path; a model not listed is 404. */
  prices: Record<string, number>;
  /** The clock `expires_at` and webhook timestamps are read from (a FakeClock's `now` in scenarios). */
  now?: () => Date;
}

const RETENTION_SECONDS = 604_800;
const KEY_RE = /^[\x21-\x7e]{1,255}$/;

export class FakeHiggsfield {
  private server: Server | null = null;
  private base = "";
  private faults: Array<{ path: RegExp; fault: FakeHiggsfieldFault; times: number }> = [];
  private correlation = 0;
  private readonly now: () => Date;
  readonly requests = new Map<string, FakeHiggsfieldRequest>();
  /** Every webhook attempted, with the exact bytes and headers sent — for signature and dedupe tests. */
  readonly deliveries: Array<{ url: string; headers: Record<string, string>; body: string; status: number | null }> = [];
  /** Every submit that reached the model (after auth and faults), keyed or not — the "0 double charges" count. */
  submits = 0;
  balanceCents: number;

  constructor(private readonly opts: FakeHiggsfieldOptions) {
    this.balanceCents = opts.balanceCents;
    this.now = opts.now ?? (() => new Date());
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        if (!res.headersSent) send(res, 500, { fake_higgsfield_bug: err instanceof Error ? err.message : String(err) }, "bug");
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.base;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  inject(path: RegExp, fault: FakeHiggsfieldFault, times = 1): void {
    this.faults.push({ path, fault, times });
  }

  /** Move a queued request to `in_progress` (it can no longer be canceled). */
  startProcessing(requestId: string): void {
    const r = this.mustGet(requestId);
    if (r.status !== "queued") throw new Error(`FakeHiggsfield: ${requestId} is ${r.status}, not queued`);
    r.status = "in_progress";
  }

  /**
   * Finish a request and (unless told not to) send its webhook. `deliver: "lost"` records nothing and
   * sends nothing — the webhook that never arrives, which polling must recover; `"twice"` sends the same
   * event (same `webhook-id`) two times, as a retry after a timeout would.
   */
  async finish(requestId: string, outcome: "completed" | "failed" | "nsfw", opts: { deliver?: "once" | "twice" | "lost"; kind?: "image" | "video" } = {}): Promise<void> {
    const r = this.mustGet(requestId);
    if (r.status !== "queued" && r.status !== "in_progress") throw new Error(`FakeHiggsfield: ${requestId} already ${r.status}`);
    r.status = outcome;
    if (outcome === "completed") {
      r.expires_at = new Date(this.now().getTime() + RETENTION_SECONDS * 1000).toISOString();
      const url = `${this.base}/files/${r.request_id}.${opts.kind === "video" ? "mp4" : "png"}`;
      r.output = opts.kind === "video" ? { video: { url, content_type: "video/mp4" } } : { images: [{ url, content_type: "image/png" }] };
    } else {
      this.balanceCents += r.price_cents; // not charged: the reservation comes back
      r.error = outcome === "failed" ? "Generation failed" : null;
    }
    if (!r.webhook || opts.deliver === "lost") return;
    const event = randomUUID();
    for (let i = 0; i < (opts.deliver === "twice" ? 2 : 1); i += 1) await this.deliver(r, event);
  }

  /** Files past `expires_at` are gone, as Higgsfield's are; a test moves the clock past it. */
  private fileExpired(requestId: string): boolean {
    const r = this.requests.get(requestId);
    return !r?.expires_at || Date.parse(r.expires_at) <= this.now().getTime();
  }

  /** The signature exactly as the docs specify, exported so the receiver's tests share one definition. */
  static sign(webhookSecret: string, id: string, timestamp: string, body: string): string {
    const key = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
    return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
  }

  // ── the HTTP surface ─────────────────────────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake");
    const corr = `fake-corr-${++this.correlation}`;
    const fileMatch = /^\/files\/([^/.]+)\.(png|mp4)$/.exec(url.pathname);
    if (req.method === "GET" && fileMatch) {
      if (this.fileExpired(fileMatch[1]!)) return send(res, 404, { detail: "Not Found" }, corr);
      res.statusCode = 200;
      res.setHeader("content-type", fileMatch[2] === "mp4" ? "video/mp4" : "image/png");
      return void res.end(Buffer.from(`fake-${fileMatch[1]}`));
    }
    if (req.headers.authorization !== `Key ${this.opts.keyId}:${this.opts.keySecret}`) return send(res, 401, { detail: "Invalid credentials" }, corr);

    const fault = this.takeFault(url.pathname);
    if (fault?.kind === "hang") return;
    if (fault?.kind === "queue_full") {
      res.setHeader("Retry-After", String(fault.retryAfterSeconds ?? 30));
      return send(res, 429, { detail: "account_queue_full" }, corr);
    }
    if (fault?.kind === "server_error") return send(res, 500, { detail: "Internal Server Error" }, corr);
    if (fault?.kind === "unavailable") return send(res, 503, { detail: "admission_control_unavailable" }, corr);

    const status = /^\/requests\/([^/]+)\/status$/.exec(url.pathname);
    if (req.method === "GET" && status) return this.readStatus(res, status[1]!, corr);
    const cancel = /^\/requests\/([^/]+)\/cancel$/.exec(url.pathname);
    if (req.method === "POST" && cancel) return this.cancel(res, cancel[1]!, corr);
    if (req.method === "POST") {
      const answer = this.submit(url, req.headers["idempotency-key"], await readBody(req));
      if (fault?.kind === "accepted_then_error" && answer.status === 200) return send(res, 500, { detail: "Internal Server Error" }, corr);
      return send(res, answer.status, answer.body, corr);
    }
    return send(res, 404, { detail: "Not Found" }, corr);
  }

  private submit(url: URL, rawKey: string | string[] | undefined, body: string): { status: number; body: unknown } {
    const model = url.pathname.replace(/^\//, "");
    const price = this.opts.prices[model];
    if (price === undefined) return { status: 404, body: { detail: "Model not found" } };
    try {
      JSON.parse(body || "{}");
    } catch {
      return { status: 400, body: { detail: "Invalid JSON body" } };
    }
    const key = typeof rawKey === "string" ? rawKey : null;
    if (key !== null && !KEY_RE.test(key)) return { status: 422, body: { detail: [{ loc: ["header", "Idempotency-Key"], msg: "invalid" }] } };
    const params = `${model}\n${body}`;
    if (key !== null) {
      const prior = [...this.requests.values()].find((r) => r.idempotency_key === key);
      if (prior && prior.params !== params) return { status: 422, body: { detail: "Idempotency-Key reused with different parameters" } };
      if (prior) return { status: 200, body: this.submitted(prior) };
    }
    this.submits += 1;
    if (this.balanceCents < price) return { status: 403, body: { detail: "Insufficient balance" } };
    this.balanceCents -= price;
    const r: FakeHiggsfieldRequest = {
      request_id: randomUUID(), model, params, idempotency_key: key, webhook: url.searchParams.get("hf_webhook"),
      status: "queued", price_cents: price, output: null, error: null, expires_at: null,
    };
    this.requests.set(r.request_id, r);
    return { status: 200, body: this.submitted(r) };
  }

  private submitted(r: FakeHiggsfieldRequest) {
    return {
      status: "queued", request_id: r.request_id,
      status_url: `${this.base}/requests/${r.request_id}/status`, cancel_url: `${this.base}/requests/${r.request_id}/cancel`,
      expires_after: RETENTION_SECONDS,
    };
  }

  private readStatus(res: ServerResponse, id: string, corr: string): void {
    const r = this.requests.get(id);
    if (!r) return send(res, 404, { detail: "Request not found" }, corr);
    const body: Record<string, unknown> = { status: r.status, request_id: r.request_id };
    if (r.status === "completed") Object.assign(body, { expires_at: r.expires_at }, r.output);
    if (r.status === "failed") body.error = r.error;
    send(res, 200, body, corr);
  }

  private cancel(res: ServerResponse, id: string, corr: string): void {
    const r = this.requests.get(id);
    if (!r) return send(res, 404, { detail: "Request not found" }, corr);
    if (r.status !== "queued") return send(res, 409, { detail: `Request is ${r.status} and cannot be canceled` }, corr);
    r.status = "canceled";
    this.balanceCents += r.price_cents;
    send(res, 200, { status: "canceled", request_id: r.request_id }, corr);
  }

  private async deliver(r: FakeHiggsfieldRequest, eventId: string): Promise<void> {
    const body = JSON.stringify({
      request_id: r.request_id, status: r.status, error: r.status === "failed" ? r.error : null,
      payload: r.status === "completed" ? r.output : null,
      ...(r.status === "completed" ? { expires_at: r.expires_at } : {}),
    });
    const timestamp = String(Math.floor(this.now().getTime() / 1000));
    const headers = {
      "content-type": "application/json", "webhook-id": eventId, "webhook-timestamp": timestamp,
      "webhook-signature": FakeHiggsfield.sign(this.opts.webhookSecret, eventId, timestamp, body),
    };
    let status: number | null;
    try {
      status = (await fetch(r.webhook!, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) })).status;
    } catch {
      status = null;
    }
    this.deliveries.push({ url: r.webhook!, headers, body, status });
  }

  private takeFault(path: string): FakeHiggsfieldFault | null {
    const rule = this.faults.find((f) => f.path.test(path) && f.times > 0);
    if (!rule) return null;
    rule.times -= 1;
    return rule.fault;
  }

  private mustGet(id: string): FakeHiggsfieldRequest {
    const r = this.requests.get(id);
    if (!r) throw new Error(`FakeHiggsfield: no request ${id}`);
    return r;
  }
}

function send(res: ServerResponse, status: number, body: unknown, correlation: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("X-Correlation-ID", correlation);
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
