import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { META_GRAPH_VERSION } from "../meta/graphClient.js";
import { FakeAdSets } from "./fakeMetaAdSets.js";
import { FakeForms } from "./fakeMetaForms.js";
import { FakeLeads } from "./fakeMetaLeads.js";
import { FakeRules } from "./fakeMetaRules.js";
import { accountInsights } from "./fakeMetaInsights.js";
import { graphError, pick } from "./fakeMetaShapes.js";

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
 *   GET  /{v}/me?fields=id,name        the token's user (a system user, for Connect). (B1b)
 *   GET  /{v}/me/permissions           `{ data: [{ permission, status }] }`, status ∈ granted, declined,
 *                                       expired. https://developers.facebook.com/docs/graph-api/reference/user/permissions/
 *   GET  /{v}/me/accounts              the Pages the token may act for: `{ data: [{ id, name, access_token,
 *                                       tasks }] }`, `tasks` e.g. ADVERTISE. https://developers.facebook.com/docs/pages-api/getting-started
 *
 * ⚠ Neither the error-handling page nor the rate-limit page states the HTTP status of an error, or
 * where `error_subcode` sits beside a throttle: this fake answers 400 (client errors and throttling)
 * and 500 (codes 1/2), and puts `error_subcode` inside `error` as the error-handling page's sample
 * does. Those two are OUR reading, not Meta's word — L4 re-runs the same contract suite against the
 * sandbox (§4R) precisely to catch a fake built on a misreading.
 *
 *   GET  /{v}/act_{id}/campaigns,       a list, `{ data: [...] }`, narrowed by `filtering=[{ field: "name",
 *        /{v}/{campaign_id}/adsets      operator: "EQUAL", value }]` — how the publisher finds what a lost
 *                                       create made (B2a). https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/
 *   POST /{v}/act_{id}/adsets           create (B2a): `name` (≤ 400), `campaign_id`, `daily_budget` > 0,
 *                                       `billing_event`, `optimization_goal`, `targeting`, `status`;
 *                                       LEAD_GENERATION needs `promoted_object.page_id`.
 *                                       https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/
 *   GET  /{v}/{adset_id}?fields=…       read back.
 *   Employment rules on an ad set, from the Special Ad Category page: no age, no gender, no ZIPs, no
 *   exclusions, every location ≥ 15 miles in the US — "enforced with a hard error", code 2909035; and a
 *   custom location's radius is 0.63–50 miles (Basic Targeting). Read 2026-11-02:
 *   https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/ and
 *   https://developers.facebook.com/docs/marketing-api/audiences/reference/basic-targeting/
 *
 * ── NOT HERE YET, ON PURPOSE ───────────────────────────────────────────────────────────────────────
 * Instant Forms live in `fakeMetaForms.ts` (B2b), Automated Rules in `fakeMetaRules.ts` (B3b). Leads in `fakeMetaLeads.ts` (B4a). Ads and creatives (B2c), the signed `leadgen` webhook (B4b), insights (B5). Each joins
 * with the step that first calls it, so every endpoint here has a caller whose contract test reads it.
 *
 * In-memory: a simulator restart forgets every campaign. That is the simulator being honest about
 * being one; B5's reconcile must then report the platform objects as missing, which is the right
 * answer for "Meta lost our campaign" too.
 */

/** The client's version, read, not restated (B1a): the fake answers only the version production calls. */
export const FAKE_META_VERSION = META_GRAPH_VERSION;

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
  | { kind: "applied_then_temporary" }
  /** `{ success: true }` and nothing changes — why the adapter answers from a read-back, not the 200 (B3). */
  | { kind: "accepted_not_applied" };

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
  /** Read back as sent; Meta defaults it to the account's tax country when absent (Special Ad Category page). */
  special_ad_category_country: string[] | null;
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
  /** What `act_{id}/insights` reports spent in any range this month (`fakeMetaInsights.ts`); default 0. */
  month_spend_cents?: number;
}

export interface FakeMetaOptions {
  /** The one access token the fake accepts. */
  token: string;
  accounts: FakeMetaAccount[];
  /** Business id the usage header is keyed by. */
  businessId?: string;
  /** The token's user (B1b's connection test). */
  user?: { id: string; name: string };
  /** What `me/permissions` reports; defaults to the six scopes Connect asks for, all granted. */
  permissions?: Record<string, "granted" | "declined" | "expired">;
  /** Pages the token can act for; each carries the Page token `me/accounts` hands out. */
  pages?: FakeMetaPage[];
}

export interface FakeMetaPage {
  id: string;
  name: string;
  access_token: string;
  tasks: string[];
}

/** The scopes the workflow's §6 click-path tells the owner to grant — the fake's default user has them. */
const DEFAULT_PERMISSIONS = ["ads_management", "ads_read", "leads_retrieval", "pages_manage_metadata", "pages_read_engagement", "pages_show_list"];

const STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] as const;
const SPECIAL = ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING", "FINANCIAL_PRODUCTS_SERVICES"];
const SPEND_CAP_MIN_CENTS = 10_000;

export class FakeMeta {
  private server: Server | null = null;
  private faults: FaultRule[] = [];
  private nextId = 120_000_000_000_000;
  private trace = 0;
  readonly campaigns = new Map<string, FakeCampaign>();
  /** Ad sets (B2a) and ads (their status, B3; their creation is B2c's), in `fakeMetaAdSets.ts`. */
  readonly sets: FakeAdSets;
  /** Instant Forms (B2b), made and read with a Page's token. */
  readonly forms: FakeForms;
  /** The leads a form collected (B4a), read with the form's Page token, in `fakeMetaLeads.ts`. */
  readonly leads: FakeLeads;
  /** Automated Rules (B3b), in `fakeMetaRules.ts`. */
  readonly rules: FakeRules;
  private revoked = false;
  readonly accounts: Map<string, FakeMetaAccount>;
  /** Every request, in order, for "exactly one create" assertions. */
  readonly requests: Array<{ method: string; path: string; body: Record<string, string> }> = [];
  private token: string;
  private readonly businessId: string;
  readonly user: { id: string; name: string };
  readonly permissions: Record<string, "granted" | "declined" | "expired">;
  readonly pages: FakeMetaPage[];

  constructor(opts: FakeMetaOptions) {
    this.token = opts.token;
    this.accounts = new Map(opts.accounts.map((a) => [a.id, { ...a }]));
    this.businessId = opts.businessId ?? "1000000000001";
    this.user = opts.user ?? { id: "61550000000001", name: "Silvicom ads system user" };
    this.permissions = { ...(opts.permissions ?? Object.fromEntries(DEFAULT_PERMISSIONS.map((p) => [p, "granted" as const]))) };
    this.pages = (opts.pages ?? []).map((p) => ({ ...p, tasks: [...p.tasks] }));
    this.forms = new FakeForms(() => String(this.nextId++), () => this.traceId());
    this.leads = new FakeLeads(() => String(this.nextId++), () => this.traceId());
    this.rules = new FakeRules(() => String(this.nextId++), () => this.traceId());
    this.sets = new FakeAdSets(() => String(this.nextId++), () => this.traceId(), (id) => this.campaigns.get(id));
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
    // A Page token is derived from the system user's grant: revoking that grant kills both.
    this.revoked = true;
  }

  /** Ad sets by id — the tests' view of what the publisher made. */
  get adsets(): Map<string, import("./fakeMetaAdSets.js").FakeAdSet> {
    return this.sets.adsets;
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
    if (token !== this.expectedToken(path)) return this.error(res, 400, 190, "OAuthException", "Error validating access token: The session has been invalidated.", 463);

    const fault = this.takeFault(method, path);
    if (fault?.kind === "hang") return; // never answered; the caller's timeout is what is under test
    if (fault?.kind === "accepted_not_applied") return send(res, 200, { success: true });
    if (fault && fault.kind !== "applied_then_temporary") return this.fault(res, fault);

    const answer = this.route(method, path, body);
    if (fault?.kind === "applied_then_temporary" && answer.status < 400) return this.fault(res, { kind: "temporary" });
    send(res, answer.status, answer.body);
  }

  /** A Page's edges and its forms answer only that Page's token (Lead Ads guide); everything else the user's. */
  private expectedToken(path: string): string | undefined {
    const [head, edge] = path.split("/");
    const pageId = edge === "leadgen_forms" ? head
      : edge === undefined || edge === "leads" ? this.forms.pageOf(head ?? "") : null;
    if (!pageId) return this.token;
    const page = this.pages.find((p) => p.id === pageId);
    return page && !this.revoked ? page.access_token : undefined;
  }

  private takeFault(method: string, path: string): FakeMetaFault | null {
    const rule = this.faults.find((f) => f.method === method && f.path.test(path) && f.times > 0);
    if (!rule) return null;
    rule.times -= 1;
    return rule.fault;
  }

  private route(method: string, path: string, body: Record<string, string>): { status: number; body: unknown } {
    if (method === "GET" && path === "me") return { status: 200, body: pick({ ...this.user }, body.fields, ["id"]) };
    if (method === "GET" && path === "me/permissions") {
      return { status: 200, body: { data: Object.entries(this.permissions).map(([permission, status]) => ({ permission, status })) } };
    }
    if (method === "GET" && path === "me/accounts") {
      return { status: 200, body: { data: this.pages.map((p) => pick({ ...p }, body.fields, ["id", "name", "access_token", "tasks"])) } };
    }
    const account = /^act_(\d+)$/.exec(path);
    if (account && method === "GET") return this.readAccount(account[1]!, body.fields);
    const insights = /^act_(\d+)\/insights$/.exec(path);
    const insightsOf = insights && method === "GET" ? this.accounts.get(insights[1]!) : undefined;
    if (insightsOf) return accountInsights(insightsOf, body, this.traceId());
    const create = /^act_(\d+)\/campaigns$/.exec(path);
    if (create && method === "POST") return this.createCampaign(create[1]!, body);
    if (create && method === "GET") return this.list([...this.campaigns.values()].filter((c) => c.account_id === create[1]), body);
    const rules = /^act_(\d+)\/adrules_library$/.exec(path);
    if (rules && method === "POST") return this.rules.create(rules[1]!, body);
    if (rules && method === "GET") return this.rules.list(rules[1]!, body.fields);
    const adsets = /^act_(\d+)\/adsets$/.exec(path);
    if (adsets && method === "POST") return this.accounts.has(adsets[1]!) ? this.sets.create(adsets[1]!, body) : graphError(400, 100, "OAuthException", "(#100) Ad account does not exist", this.traceId());
    const children = /^(\d+)\/adsets$/.exec(path);
    if (children && method === "GET") return this.list([...this.sets.adsets.values()].filter((a) => a.campaign_id === children[1]), body);
    const formLeads = /^(\d+)\/leads$/.exec(path);
    if (formLeads && method === "GET") {
      return this.forms.pageOf(formLeads[1]!) ? this.leads.list(formLeads[1]!, body)
        : graphError(400, 100, "GraphMethodException", `Unsupported get request. Object with ID '${formLeads[1]}' does not exist.`, this.traceId(), 33);
    }
    const pageForms = /^(\d+)\/leadgen_forms$/.exec(path);
    if (pageForms && method === "POST") return this.forms.create(pageForms[1]!, body);
    if (pageForms && method === "GET") return this.forms.list(pageForms[1]!, body.fields);
    const one = /^(\d+)$/.exec(path);
    const form = one && method === "GET" ? this.forms.read(one[1]!, body.fields) : null;
    if (form) return form;
    const rule = one && method === "POST" ? this.rules.update(one[1]!, body) : null;
    if (rule) return rule;
    const child = one ? this.sets.route(method, one[1]!, body) : null;
    if (child) return child;
    if (one && method === "GET") return this.readCampaign(one[1]!, body.fields);
    if (one && method === "POST") return this.updateCampaign(one[1]!, body);
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
      special_ad_categories: (categories as string[]).map(String), special_ad_category_country: countries(b.special_ad_category_country), spend_cap: b.spend_cap ?? null, daily_budget: b.daily_budget ?? null,
    });
    return { status: 200, body: { id, success: true } };
  }

  /** An edge read: `{ data }`, narrowed by a name-EQUAL `filtering` (the one filter our callers send). */
  private list(rows: Array<{ name: string }>, b: Record<string, string>) {
    let filters: unknown;
    try {
      filters = b.filtering === undefined ? [] : JSON.parse(b.filtering);
    } catch {
      filters = null;
    }
    if (!Array.isArray(filters)) return graphError(400, 100, "OAuthException", "(#100) filtering must be an array", this.traceId());
    let out = rows;
    for (const f of filters as Array<{ field?: unknown; operator?: unknown; value?: unknown }>) {
      if (f.field !== "name" || f.operator !== "EQUAL") return graphError(400, 100, "OAuthException", `(#100) FakeMeta filters only name EQUAL, got ${String(f.field)} ${String(f.operator)}`, this.traceId());
      out = out.filter((r) => r.name === f.value);
    }
    return { status: 200, body: { data: out.map((r) => pick({ ...r }, b.fields, ["id"])) } };
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

  private fault(res: ServerResponse, f: Exclude<FakeMetaFault, { kind: "hang" } | { kind: "applied_then_temporary" } | { kind: "accepted_not_applied" }>): void {
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

function countries(raw: string | undefined): string[] | null {
  try {
    const v: unknown = raw === undefined ? null : JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
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
