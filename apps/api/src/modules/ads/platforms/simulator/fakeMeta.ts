import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * FakeMeta — an in-process `node:http` server that answers the Marketing API calls our Meta adapter
 * makes, in Meta's documented shapes, with faults injected per call (ADS-AGENT-BUILD-WORKFLOW.md §4R,
 * "The harness"). Two users: the adapter's contract tests (B1–B3), and the SIMULATOR platform on a
 * positively non-production host (`simulatorGate.ts`), which is why it lives beside the adapters and
 * not under `testing/`.
 *
 * ── WHAT IT IMPLEMENTS, AND WHERE EACH SHAPE IS FROM (read 2026-11-02) ───────────────────────────
 *   GET  /{v}/act_{id}?fields=…        ad account: `spend_cap` and `amount_spent` as numeric strings in
 *                                       cents, `spend_cap` "0" = no cap; `account_status` 1 = ACTIVE;
 *                                       `currency`. https://developers.facebook.com/docs/marketing-api/reference/ad-account/
 *   POST /{v}/act_{id}/campaigns        create: `special_ad_categories` REQUIRED; `status` only ACTIVE or
 *                                       PAUSED at creation; `spend_cap` minimum $100 → `{ id, success }`.
 *   POST /{v}/{campaign_id}             update: `status` ∈ ACTIVE, PAUSED, DELETED, ARCHIVED → `{ success }`.
 *   GET  /{v}/{campaign_id}?fields=…    read: `status`, `effective_status`, `spend_cap`, `daily_budget`
 *                                       (numeric strings). https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 *   Errors: `{ error: { message, type, code, error_subcode?, fbtrace_id } }`; 190/463 expired token,
 *   100 invalid parameter, 1/2 temporary. https://developers.facebook.com/docs/graph-api/guides/error-handling/
 *   Throttle: code 80004 subcode 2446079 (Ads Management) with `X-Business-Use-Case-Usage`
 *   `{ <business id>: [{ type, call_count, total_cputime, total_time, estimated_time_to_regain_access }] }`.
 *   https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 *
 * ⚠ Neither the error-handling page nor the rate-limit page states the HTTP status of an error, or
 * where `error_subcode` sits beside a throttle: this fake answers 400 (client errors and throttling)
 * and 500 (codes 1/2), and puts `error_subcode` inside `error` as the error-handling page's sample
 * does. Those two are OUR reading, not Meta's word — L4 re-runs the same contract suite against the
 * sandbox (§4R) precisely to catch a fake built on a misreading.
 *
 * ── NOT HERE YET, ON PURPOSE ───────────────────────────────────────────────────────────────────────
 * Ad sets, ads, Instant Forms (B2), leads + the signed `leadgen` webhook (B4), insights (B5). Each joins
 * with the step that first calls it, so every endpoint here has a caller whose contract test reads it.
 *
 * In-memory: a simulator restart forgets every campaign. That is the simulator being honest about
 * being one; B5's reconcile must then report the platform objects as missing, which is the right
 * answer for "Meta lost our campaign" too.
 */

export const FAKE_META_VERSION = "v24.0";

export type FakeMetaFault =
  /** 80004 / 2446079, with the usage header at 100 %. */
  | { kind: "throttle"; regainMinutes?: number }
  /** code 1 or 2, HTTP 500. */
  | { kind: "temporary"; code?: 1 | 2 }
  /** 190 / 463: the token expired or was revoked. */
  | { kind: "token_expired" }
  /** Holds the response until the caller gives up (the request is never answered). */
  | { kind: "hang" }
  /** The act HAPPENS, then the answer is an error — the half-created object the adapter must resume. */
  | { kind: "applied_then_temporary" };

interface FaultRule {
  method: "GET" | "POST";
  /** Matches the path after the version, e.g. `act_1/campaigns` or a campaign id. */
  path: RegExp;
  fault: FakeMetaFault;
  times: number;
}

export interface FakeCampaign {
  id: string;
  account_id: string;
  name: string;
  objective: string | null;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  special_ad_categories: string[];
  spend_cap: string | null;
  daily_budget: string | null;
}

export interface FakeMetaAccount {
  id: string;
  /** Cents; 0 = no cap (Meta's own rule). */
  spend_cap_cents: number;
  amount_spent_cents: number;
  account_status: number;
  currency: string;
}

export interface FakeMetaOptions {
  /** The one access token the fake accepts. */
  token: string;
  accounts: FakeMetaAccount[];
  /** Business id the usage header is keyed by. */
  businessId?: string;
}

const STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] as const;
const SPECIAL = ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING", "FINANCIAL_PRODUCTS_SERVICES"];
const SPEND_CAP_MIN_CENTS = 10_000;

export class FakeMeta {
  private server: Server | null = null;
  private faults: FaultRule[] = [];
  private nextId = 120_000_000_000_000;
  private trace = 0;
  readonly campaigns = new Map<string, FakeCampaign>();
  readonly accounts: Map<string, FakeMetaAccount>;
  /** Every request, in order, for "exactly one create" assertions. */
  readonly requests: Array<{ method: string; path: string; body: Record<string, string> }> = [];
  private token: string;
  private readonly businessId: string;

  constructor(opts: FakeMetaOptions) {
    this.token = opts.token;
    this.accounts = new Map(opts.accounts.map((a) => [a.id, { ...a }]));
    this.businessId = opts.businessId ?? "1000000000001";
  }

  async start(): Promise<string> {
    // A bug in the fake must not look like an injected `hang` (a request left unanswered): it answers
    // 500 with a body that names it, so a test that trips it fails on the fake, not on a timeout.
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        if (!res.headersSent) send(res, 500, { fake_meta_bug: err instanceof Error ? err.message : String(err) });
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/${FAKE_META_VERSION}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  /** The next `times` requests matching method + path get this fault instead of their answer. */
  inject(method: "GET" | "POST", path: RegExp, fault: FakeMetaFault, times = 1): void {
    this.faults.push({ method, path, fault, times });
  }

  /** The owner revokes our access in Business Settings: every call from now on is 190/463. */
  revokeToken(): void {
    this.token = `revoked:${this.token}`;
  }

  /** Someone used Ads Manager: the platform changed a campaign we did not ask it to (D-AD4). */
  externalStatusChange(campaignId: string, status: FakeCampaign["status"]): void {
    const c = this.campaigns.get(campaignId);
    if (!c) throw new Error(`FakeMeta: no campaign ${campaignId}`);
    c.status = status;
  }

  // ── the HTTP surface ─────────────────────────────────────────────────────────────────────────

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake");
    const raw = await readBody(req);
    const body = Object.fromEntries(new URLSearchParams(raw));
    for (const [k, v] of url.searchParams) if (!(k in body)) body[k] = v;
    const method = req.method === "POST" ? "POST" : "GET";
    const parts = url.pathname.split("/").filter(Boolean);
    this.requests.push({ method, path: url.pathname, body: redact(body) });

    if (parts[0] !== FAKE_META_VERSION) return this.error(res, 400, 2635, "OAuthException", `(#2635) Unsupported API version ${parts[0] ?? ""}`);
    const path = parts.slice(1).join("/");
    const token = body.access_token ?? bearer(req);
    if (token !== this.token) return this.error(res, 400, 190, "OAuthException", "Error validating access token: The session has been invalidated.", 463);

    const fault = this.takeFault(method, path);
    if (fault?.kind === "hang") return; // never answered; the caller's timeout is what is under test
    if (fault && fault.kind !== "applied_then_temporary") return this.fault(res, fault);

    const answer = this.route(method, path, body);
    if (fault?.kind === "applied_then_temporary" && answer.status < 400) return this.fault(res, { kind: "temporary" });
    send(res, answer.status, answer.body);
  }

  private takeFault(method: string, path: string): FakeMetaFault | null {
    const rule = this.faults.find((f) => f.method === method && f.path.test(path) && f.times > 0);
    if (!rule) return null;
    rule.times -= 1;
    return rule.fault;
  }

  private route(method: string, path: string, body: Record<string, string>): { status: number; body: unknown } {
    const account = /^act_(\d+)$/.exec(path);
    if (account && method === "GET") return this.readAccount(account[1]!, body.fields);
    const create = /^act_(\d+)\/campaigns$/.exec(path);
    if (create && method === "POST") return this.createCampaign(create[1]!, body);
    const campaign = /^(\d+)$/.exec(path);
    if (campaign && method === "GET") return this.readCampaign(campaign[1]!, body.fields);
    if (campaign && method === "POST") return this.updateCampaign(campaign[1]!, body);
    return graphError(400, 100, "GraphMethodException", `Unsupported ${method} request. Object with ID '${path}' does not exist.`, this.traceId(), 33);
  }

  private readAccount(id: string, fields?: string) {
    const a = this.accounts.get(id);
    if (!a) return graphError(400, 100, "GraphMethodException", `Unsupported get request. Object with ID 'act_${id}' does not exist.`, this.traceId(), 33);
    const full: Record<string, unknown> = {
      id: `act_${a.id}`, account_id: a.id, spend_cap: String(a.spend_cap_cents), amount_spent: String(a.amount_spent_cents),
      account_status: a.account_status, currency: a.currency,
    };
    return { status: 200, body: pick(full, fields, ["id", "account_id"]) };
  }

  private createCampaign(accountId: string, b: Record<string, string>) {
    if (!this.accounts.has(accountId)) return graphError(400, 100, "OAuthException", "(#100) Ad account does not exist", this.traceId());
    let categories: unknown;
    try {
      categories = b.special_ad_categories === undefined ? undefined : JSON.parse(b.special_ad_categories);
    } catch {
      categories = null;
    }
    if (!Array.isArray(categories) || categories.some((c) => !SPECIAL.includes(String(c)))) {
      return graphError(400, 100, "OAuthException", "(#100) The parameter special_ad_categories is required", this.traceId());
    }
    if (b.status !== undefined && b.status !== "ACTIVE" && b.status !== "PAUSED") {
      return graphError(400, 100, "OAuthException", "(#100) Only ACTIVE and PAUSED are valid during creation", this.traceId());
    }
    if (b.spend_cap !== undefined && !(Number(b.spend_cap) >= SPEND_CAP_MIN_CENTS)) {
      return graphError(400, 100, "OAuthException", "(#100) spend_cap must be at least $100", this.traceId());
    }
    const id = String(this.nextId++);
    this.campaigns.set(id, {
      id, account_id: accountId, name: b.name ?? "", objective: b.objective ?? null, status: (b.status as FakeCampaign["status"]) ?? "ACTIVE",
      special_ad_categories: (categories as string[]).map(String), spend_cap: b.spend_cap ?? null, daily_budget: b.daily_budget ?? null,
    });
    return { status: 200, body: { id, success: true } };
  }

  private readCampaign(id: string, fields?: string) {
    const c = this.campaigns.get(id);
    if (!c) return graphError(400, 100, "GraphMethodException", `Unsupported get request. Object with ID '${id}' does not exist.`, this.traceId(), 33);
    const effective = c.status;
    return { status: 200, body: pick({ ...c, effective_status: effective }, fields, ["id"]) };
  }

  private updateCampaign(id: string, b: Record<string, string>) {
    const c = this.campaigns.get(id);
    if (!c) return graphError(400, 100, "GraphMethodException", `Unsupported post request. Object with ID '${id}' does not exist.`, this.traceId(), 33);
    if (b.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(b.status)) return graphError(400, 100, "OAuthException", "(#100) Invalid status", this.traceId());
      c.status = b.status as FakeCampaign["status"];
    }
    if (b.daily_budget !== undefined) c.daily_budget = b.daily_budget;
    if (b.spend_cap !== undefined) c.spend_cap = b.spend_cap;
    return { status: 200, body: { success: true } };
  }

  private fault(res: ServerResponse, f: Exclude<FakeMetaFault, { kind: "hang" } | { kind: "applied_then_temporary" }>): void {
    if (f.kind === "throttle") {
      res.setHeader("X-Business-Use-Case-Usage", JSON.stringify({
        [this.businessId]: [{ type: "ads_management", call_count: 100, total_cputime: 34, total_time: 41, estimated_time_to_regain_access: f.regainMinutes ?? 5 }],
      }));
      return this.error(res, 400, 80004, "OAuthException", "(#80004) There have been too many calls to this ad-account.", 2446079);
    }
    if (f.kind === "token_expired") return this.error(res, 400, 190, "OAuthException", "Error validating access token: Session has expired.", 463);
    const code = f.code ?? 2;
    return this.error(res, 500, code, "OAuthException", code === 1 ? "An unknown error occurred" : "An unexpected error has occurred. Please retry your request later.");
  }

  private error(res: ServerResponse, status: number, code: number, type: string, message: string, subcode?: number): void {
    const answer = graphError(status, code, type, message, this.traceId(), subcode);
    send(res, answer.status, answer.body);
  }

  private traceId(): string {
    return `FakeTrace${String(++this.trace).padStart(6, "0")}`;
  }
}

function graphError(status: number, code: number, type: string, message: string, fbtrace_id: string, error_subcode?: number) {
  return { status, body: { error: { message, type, code, ...(error_subcode === undefined ? {} : { error_subcode }), fbtrace_id } } };
}

/** `fields=` as Graph answers it: the named fields plus the defaults; no `fields` = defaults only. */
function pick(row: Record<string, unknown>, fields: string | undefined, defaults: string[]): Record<string, unknown> {
  const want = new Set([...defaults, ...(fields ? fields.split(",").map((f) => f.trim()).filter(Boolean) : [])]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => want.has(k)));
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

/** A recorded request never holds the token — a test that prints `requests` must not print a secret. */
function redact(body: Record<string, string>): Record<string, string> {
  return "access_token" in body ? { ...body, access_token: "[redacted]" } : body;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=UTF-8");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
