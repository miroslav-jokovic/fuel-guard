import type { GraphFailure, MetaGraph } from "./graphClient.js";

/**
 * The Meta connection test (ADS-AGENT-BUILD-WORKFLOW.md B1: "account, Page, spending limit, permissions").
 * It runs when an admin connects, whenever someone presses Test, and against FakeMeta on the simulator.
 * The report is what Settings › Ads control shows (E1) and what `ads_platform_connections.last_test` keeps.
 *
 * ── WHAT EACH CHECK ASKS, AND WHY IT IS A CHECK ──────────────────────────────────────────────────
 *   token          `GET me` answers: the token is alive. An invalid token stops the test there, because
 *                  every other answer would be the same refusal.
 *   permissions    `GET me/permissions` grants every scope the click-path asks the owner for (workflow §6
 *                  step 4). A missing scope fails, naming it. An EXTRA scope is reported, not failed: the
 *                  plan's security review asks for the least scopes (ADS-AGENT-PLAN §7), but refusing a
 *                  working token over that would push the owner to start over for no safety gain today.
 *   ad_account     the account answers and is ACTIVE (`account_status` 1).
 *   currency       USD. Every amount in the ads module is US cents; another currency would make every
 *                  cap a different number of dollars than the screen says.
 *   spending_limit Meta's own account spending limit is set (`spend_cap` "0" = none). D-AD3 fence 3: the
 *                  guard refuses every launch without it, so a connection without one would look ready
 *                  and could never launch.
 *   page           the token can act for the Page, with the ADVERTISE task. Its Page token is handed back
 *                  to be SEALED, never put in the report (workflow §1.2-3: leads need a Page token).
 *   leadgen        (B4b) the Page is subscribed to our app's `leadgen` webhook: `POST {page}/subscribed_apps
 *                  ?subscribed_fields=leadgen` with that Page token, "A Page access token requested by a
 *                  person who can perform" CREATE_CONTENT, MANAGE or MODERATE, plus `pages_manage_metadata`
 *                  (https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/, read
 *                  2026-11-03). Idempotent — a second subscribe is the same `{ success: true }` — so every
 *                  test repeats it, and a Page whose subscription was removed in Meta is put back by Test.
 *                  ⚠ Meta delivers only for "fields with subscriptions at both the page and app levels": the
 *                  APP-level half is the App Dashboard's (owner track) and cannot be checked with this token,
 *                  so a pass here means the Page half only. Unproven against the real app until L4. A
 *                  failure fails the connection: without it, leads arrive only by the hourly backfill.
 *
 * The Page token travels beside the report, not inside it, so the report can be stored and shown as it
 * is. Nothing in this file logs.
 */

export const META_SCOPES = ["ads_management", "ads_read", "leads_retrieval", "pages_manage_metadata", "pages_read_engagement", "pages_show_list"] as const;

export const CONNECTION_CHECKS = ["token", "permissions", "ad_account", "currency", "spending_limit", "page", "leadgen"] as const;
export type ConnectionCheckKey = (typeof CONNECTION_CHECKS)[number];

export interface ConnectionCheck {
  key: ConnectionCheckKey;
  /** null = not reached (an earlier check made it meaningless). */
  ok: boolean | null;
  detail: string;
}

export interface ConnectionReport {
  ok: boolean;
  checks: ConnectionCheck[];
  user: { id: string; name: string | null } | null;
  account: { id: string; name: string | null; account_status: number | null; currency: string | null; spend_cap_cents: number | null; amount_spent_cents: number | null } | null;
  page: { id: string; name: string | null; tasks: string[] } | null;
  scopes_granted: string[];
  scopes_extra: string[];
  /** The first failed check's Meta code (`token_invalid`, `meta_100`…) or the check's own key. */
  error_code: string | null;
}

export interface ConnectionTestResult {
  report: ConnectionReport;
  /** The Page token `me/accounts` handed out — for sealing only. */
  pageToken: string | null;
  /** True only when Meta said the token itself is no good: then nothing is stored. */
  tokenRefused: boolean;
}

export interface ConnectionTarget {
  /** Digits, with or without `act_`. */
  accountId: string;
  pageId: string;
}

const NOT_REACHED = (key: ConnectionCheckKey): ConnectionCheck => ({ key, ok: null, detail: "Not checked: an earlier check failed." });

const meta = (f: GraphFailure): string => `${f.message || f.error_code}${f.code !== null ? ` (Meta code ${f.code})` : ""}`;

export async function testMetaConnection(graph: MetaGraph, target: ConnectionTarget): Promise<ConnectionTestResult> {
  const accountId = target.accountId.replace(/^act_/, "");
  const checks: ConnectionCheck[] = [];
  const report: ConnectionReport = { ok: false, checks, user: null, account: null, page: null, scopes_granted: [], scopes_extra: [], error_code: null };
  const finish = (pageToken: string | null, tokenRefused = false): ConnectionTestResult => {
    for (const key of CONNECTION_CHECKS) if (!checks.some((c) => c.key === key)) checks.push(NOT_REACHED(key));
    checks.sort((a, b) => CONNECTION_CHECKS.indexOf(a.key) - CONNECTION_CHECKS.indexOf(b.key));
    report.ok = checks.every((c) => c.ok === true);
    return { report, pageToken, tokenRefused };
  };
  const check = (key: ConnectionCheckKey): boolean => checks.some((c) => c.key === key && c.ok === true);
  const fail = (key: ConnectionCheckKey, detail: string, code: string) => {
    checks.push({ key, ok: false, detail });
    report.error_code ??= code;
  };

  // token
  const me = await graph.get<{ id: string; name?: string }>("me", { fields: "id,name" });
  if (!me.ok) {
    const refused = me.error.kind === "token_invalid";
    fail("token", refused ? `Meta does not accept this token: ${meta(me.error)}. Generate a new system-user token.` : `Meta did not answer: ${meta(me.error)}.`, me.error.error_code);
    return finish(null, refused);
  }
  report.user = { id: me.data.id, name: me.data.name ?? null };
  checks.push({ key: "token", ok: true, detail: `Accepted, for ${me.data.name ?? me.data.id}.` });

  // permissions
  const perms = await graph.get<{ data?: Array<{ permission?: string; status?: string }> }>("me/permissions");
  if (!perms.ok) fail("permissions", `Could not read the token's permissions: ${meta(perms.error)}.`, perms.error.error_code);
  else {
    const granted = (perms.data.data ?? []).filter((p) => p.status === "granted" && typeof p.permission === "string").map((p) => p.permission!);
    report.scopes_granted = [...granted].sort();
    report.scopes_extra = granted.filter((p) => !(META_SCOPES as readonly string[]).includes(p)).sort();
    const missing = META_SCOPES.filter((s) => !granted.includes(s));
    const extra = report.scopes_extra.length ? ` Also granted, and not needed: ${report.scopes_extra.join(", ")}.` : "";
    if (missing.length) fail("permissions", `Missing: ${missing.join(", ")}. Generate the token again with every permission listed.${extra}`, "permissions_missing");
    else checks.push({ key: "permissions", ok: true, detail: `All ${META_SCOPES.length} granted.${extra}` });
  }

  // ad account, currency, spending limit
  const acct = await graph.get<{ id: string; name?: string; account_status?: number; currency?: string; spend_cap?: string; amount_spent?: string }>(
    `act_${accountId}`, { fields: "name,account_status,currency,spend_cap,amount_spent" });
  if (!acct.ok) fail("ad_account", `Ad account ${accountId} could not be read: ${meta(acct.error)}.`, acct.error.error_code);
  else {
    const a = acct.data;
    const cap = a.spend_cap === undefined ? null : Number(a.spend_cap);
    report.account = {
      id: accountId, name: a.name ?? null, account_status: a.account_status ?? null, currency: a.currency ?? null,
      spend_cap_cents: cap !== null && Number.isFinite(cap) && cap > 0 ? cap : null,
      amount_spent_cents: a.amount_spent === undefined ? null : Number(a.amount_spent),
    };
    if (a.account_status === 1) checks.push({ key: "ad_account", ok: true, detail: `${a.name ?? accountId} is active.` });
    else fail("ad_account", `Ad account ${a.name ?? accountId} is not active (Meta status ${a.account_status ?? "unknown"}).`, "account_not_active");
    if (a.currency === "USD") checks.push({ key: "currency", ok: true, detail: "US dollars." });
    else fail("currency", `The account bills in ${a.currency ?? "an unknown currency"}; every limit here is in US dollars.`, "currency_not_usd");
    if (report.account.spend_cap_cents !== null) checks.push({ key: "spending_limit", ok: true, detail: `$${(report.account.spend_cap_cents / 100).toLocaleString("en-US")} set in Meta.` });
    else fail("spending_limit", "No account spending limit is set in Meta. Set one in Meta's Billing › Payment settings; every launch is refused until it is.", "spending_limit_unset");
  }

  // page
  const pages = await graph.get<{ data?: Array<{ id?: string; name?: string; access_token?: string; tasks?: string[] }> }>("me/accounts", { fields: "id,name,access_token,tasks" });
  let pageToken: string | null = null;
  if (!pages.ok) fail("page", `Could not list the Pages this token can act for: ${meta(pages.error)}.`, pages.error.error_code);
  else {
    const p = (pages.data.data ?? []).find((x) => x.id === target.pageId);
    if (!p) fail("page", `The token cannot act for Page ${target.pageId}. In Business settings, assign the Page to the system user.`, "page_not_assigned");
    else {
      report.page = { id: target.pageId, name: p.name ?? null, tasks: [...(p.tasks ?? [])] };
      pageToken = typeof p.access_token === "string" && p.access_token ? p.access_token : null;
      if (!(p.tasks ?? []).includes("ADVERTISE")) fail("page", `The system user may not advertise for ${p.name ?? target.pageId} (no ADVERTISE task).`, "page_cannot_advertise");
      else if (!pageToken) fail("page", `Meta gave no Page token for ${p.name ?? target.pageId}.`, "page_token_missing");
      else checks.push({ key: "page", ok: true, detail: `${p.name ?? target.pageId}: may advertise; Page token received.` });
    }
  }
  // leadgen — only for a Page that passed, with the Page token it handed out.
  if (check("page") && pageToken) {
    const sub = await graph.withToken(pageToken).post<{ success?: boolean }>(`${target.pageId}/subscribed_apps`, { subscribed_fields: "leadgen" }, { idempotent: true });
    // Meta's code 200 is a permission error: here, a system user with no content or moderation task on the Page.
    const why = (f: GraphFailure) => (f.code === 200 ? " In Business settings, give the system user the Moderate (or Create content) task on the Page." : "");
    if (!sub.ok) fail("leadgen", `The Page could not be subscribed to new leads: ${meta(sub.error)}.${why(sub.error)} Leads still arrive within the hour.`, sub.error.error_code);
    else if (sub.data.success !== true) fail("leadgen", "Meta did not confirm the Page's subscription to new leads. Leads still arrive within the hour.", "leadgen_not_subscribed");
    else checks.push({ key: "leadgen", ok: true, detail: "Subscribed to new leads (the app's own webhook setting is checked in Meta)." });
  }
  // A Page token is handed on only from a Page that passed: one we may not advertise for is not ours to keep.
  return finish(check("page") ? pageToken : null);
}
