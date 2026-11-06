import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { FaultBook, faultAnswer } from "../../simulator/fakeMetaFaults.js";
import { META_GRAPH_VERSION } from "../graphClient.js";

/**
 * The fault proxy (Publisher L3, 2026-11-05): an in-process `node:http` server between the Graph client and
 * a contract TARGET — FakeMeta at L3, Meta's sandbox at L4 (`metaTarget.ts`). It forwards every call
 * untouched, except the ones a test booked a fault for, and it keeps a log of what crossed the wire.
 *
 * WHY THE FAULTS LIVE HERE AND NOT IN THE FAKE. §4R wants the same contract suite to run against FakeMeta
 * and, the day credentials arrive, against the sandbox, unchanged. Meta's sandbox will not answer a 429 or
 * hang a create on request; only something in front of it can. Injecting at this one place means the L3 run
 * and the L4 run meet the SAME faults through the SAME code, and the fake run exercises the very proxy the
 * sandbox run will lean on — it is never code that first runs on certification day.
 *
 * What each fault does (`fakeMetaFaults.ts` has the answers):
 *   throttle · temporary · token_expired — answered here; the call never reaches the target.
 *   hang                  — never forwarded, never answered: the client's timeout is under test. The object
 *                           is therefore truly NOT made, which is what makes "campaign yes, ad set no" real.
 *   applied_then_temporary — forwarded; if the target made it, the answer is replaced by a 5xx: the
 *                           half-created object a lost answer leaves behind.
 *   accepted_not_applied  — answered `{ success: true }` here; nothing reaches the target.
 *
 * And one that is not a fault (stage2-kit-2c): `overlay` plays a verdict only the platform gives — Meta turning
 * an ad down — on a GET the target answered, by setting fields of its answer. Meta's sandbox will not reject an
 * ad on request either, so the monitor's rejected-ad path meets the same overlaid answer on both targets.
 *
 * The log never holds a token: the Authorization header is not recorded, and a body `access_token` is
 * redacted, as FakeMeta's own log does.
 */

export interface ProxiedCall {
  method: "GET" | "POST";
  /** The path after the version, as the fault book and FakeMeta match it: `act_1/campaigns`, `123`. */
  path: string;
  /** The form body (POST) or the query (GET), each value as sent — objects are JSON strings. */
  body: Record<string, string>;
  /** The fault booked for this call, if one was. */
  fault: string | null;
  /** The TARGET's answer: null when the call never reached it (an answered fault, a hang). */
  upstream: { status: number; body: unknown } | null;
}

export class FaultProxy {
  readonly faults = new FaultBook();
  readonly calls: ProxiedCall[] = [];
  private readonly overlays: Array<{ path: RegExp; fields: Record<string, unknown> }> = [];
  private server: Server | null = null;
  private trace = 0;

  /** `upstream` is a version-qualified Graph base: FakeMeta's `start()` answer, or the real Graph host's. */
  constructor(private readonly upstream: string, private readonly businessId = "1000000000001") {}

  /** The base the client is pointed at — this proxy, with the version production calls. */
  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        if (!res.headersSent) send(res, 502, { fault_proxy_bug: err instanceof Error ? err.message : String(err) }, {});
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/${META_GRAPH_VERSION}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** Every later successful GET of a path matching `path` answers `fields` over what the target said. */
  overlay(path: RegExp, fields: Record<string, unknown>): void {
    this.overlays.push({ path, fields });
  }

  /** Every POST to a path matching `edge` that the TARGET answered with success — what it really made. */
  made(edge: RegExp): ProxiedCall[] {
    return this.calls.filter((c) => c.method === "POST" && edge.test(c.path) && c.upstream !== null && c.upstream.status < 400);
  }

  /** Every POST to a path matching `edge` that left this client, made or not. */
  sent(edge: RegExp): ProxiedCall[] {
    return this.calls.filter((c) => c.method === "POST" && edge.test(c.path));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://proxy");
    const raw = await readBody(req);
    const method = req.method === "POST" ? "POST" : "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    // Anything not on the version production calls is forwarded as asked: the target answers it, not us.
    const path = (parts[0] === META_GRAPH_VERSION ? parts.slice(1) : parts).join("/");
    const body = method === "POST" ? Object.fromEntries(new URLSearchParams(raw)) : Object.fromEntries(url.searchParams);
    const fault = this.faults.take(method, path);
    const call: ProxiedCall = { method, path, body: redact(body), fault: fault?.kind ?? null, upstream: null };
    this.calls.push(call);

    if (fault?.kind === "hang") return;
    if (fault?.kind === "accepted_not_applied") return send(res, 200, { success: true }, {});
    if (fault && fault.kind !== "applied_then_temporary") {
      const a = faultAnswer(fault, this.businessId, this.traceId());
      return send(res, a.status, a.body, a.headers);
    }

    const target = new URL(`${this.upstream.replace(/\/$/, "")}/${path}${url.search}`);
    const forwarded = await fetch(target, {
      method,
      headers: pickHeaders(req, ["authorization", "content-type"]),
      body: method === "POST" ? raw : undefined,
    });
    const text = await forwarded.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    call.upstream = { status: forwarded.status, body: parsed };
    if (fault?.kind === "applied_then_temporary" && forwarded.status < 400) {
      const a = faultAnswer({ kind: "temporary" }, this.businessId, this.traceId());
      return send(res, a.status, a.body, a.headers);
    }
    const usage = forwarded.headers.get("x-business-use-case-usage");
    const over = method === "GET" && forwarded.status < 400 && parsed && typeof parsed === "object" ? this.overlays.filter((o) => o.path.test(path)) : [];
    if (over.length > 0) parsed = Object.assign({}, parsed, ...over.map((o) => o.fields));
    send(res, forwarded.status, parsed, usage ? { "X-Business-Use-Case-Usage": usage } : {});
  }

  private traceId(): string {
    return `ProxyTrace${String(++this.trace).padStart(6, "0")}`;
  }
}

function pickHeaders(req: IncomingMessage, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = req.headers[n];
    if (typeof v === "string") out[n] = v;
  }
  return out;
}

function redact(body: Record<string, string>): Record<string, string> {
  return "access_token" in body ? { ...body, access_token: "[redacted]" } : body;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader("content-type", "application/json; charset=UTF-8");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
