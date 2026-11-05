import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADS_CAMPAIGN_WORKERS, type AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { STEP_UP_TOKEN_HEADER, mintStepUpToken } from "../../../lib/stepUpToken.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { everyRoute } from "../../../testing/routeWalk.js";
import { LIVE_SETTINGS } from "../../../testing/adsWorld.js";
import { HIGGSFIELD_KEY_PURPOSE } from "../creative/higgsfield/higgsfieldKey.js";
import { metaPageTokenPurpose, metaTokenPurpose, stopSimulatorForTests } from "../platforms/registry.js";

/**
 * Security L3, two rows of §4R's "Security (all)" (ADS-AGENT-BUILD-WORKFLOW; G-sec, 2026-11-05), over ONE sweep:
 * every `/api/ads` route the real app serves, called once by an admin with a fresh sign-in, against a database
 * holding TWO carriers. The route list is the app's own (`testing/routeWalk.ts`): a route this sweep does not
 * call fails it, so a new door cannot skip the scrape.
 *
 *   · a token in an API response — every body is scraped for the Meta system-user token, the Page token, the
 *     Higgsfield key, the app secret, the sealing key, each sealed ciphertext, and the two sealed columns' names.
 *     Meta, stubbed at `fetch`, echoes the token it was sent inside its error messages, which is the case
 *     `MetaGraph.scrub` exists for; the Connect and Test answers carry those messages in their report.
 *   · a cross-org read — the other carrier's rows sit in every table the routes read, and the fixture applies
 *     filters as PostgREST does (`postgrestFixture`), so a query that forgets `org_id` hands their ids back and
 *     the scrape of every body finds them. `expectOrgScoped` then holds every query and write to this org,
 *     which also catches a forgotten filter on a read by id that would have returned nothing to see.
 * L2 pinned each door by hand; this is the same question asked of all of them at once.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "5b6c7d8e-9f00-4a1b-8c2d-3e4f5a6b7c8d";
const SEALING_KEY = Buffer.alloc(32, 7).toString("base64");
const APP_SECRET = "app-secret-0d9e8f7a6b5c4d3e2f1a";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: SEALING_KEY, META_APP_SECRET: APP_SECRET } as NodeJS.ProcessEnv);

/** The credentials, each unmistakable in a body. */
const TOKEN = "EAAGsystemusertokenAAAA1111222233334444";
const PAGE_TOKEN = "EAAGpagetokenBBBB5555666677778888";
const HF_KEY = "hfkeyid:hfsecretCCCC9999000011112222";

/** Ids per org, so a body naming the other org's row is found by value. */
const idsOf = (n: number) => ({
  conn: `${n}c0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  hf: `${n}d0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  campaign: `${n}e0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  creative: `${n}f0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  approval: `${n}a0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  action: `${n}b0e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  kit: `${n}10e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  preset: `${n}20e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
  settings: `${n}30e0c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b`,
});
const MINE = idsOf(1);
const THEIRS = idsOf(2);
const T = "2026-11-05T12:00:00.000Z";

function carrier(org: string, ids: ReturnType<typeof idsOf>): Record<string, FixtureRow[]> {
  const sealed = {
    token: seal(env, TOKEN, secretAad(org, metaTokenPurpose(false))),
    page: seal(env, PAGE_TOKEN, secretAad(org, metaPageTokenPurpose(false))),
    hf: seal(env, HF_KEY, secretAad(org, HIGGSFIELD_KEY_PURPOSE)),
  };
  sealedValues.push(sealed.token, sealed.page, sealed.hf);
  return {
    ads_settings_versions: [{ id: ids.settings, org_id: org, version: 1, settings: LIVE_SETTINGS, kill_switch: false, kill_reason: null, created_at: T, created_by: "u-admin", created_by_name: "Admin" }],
    ads_platform_connections: [
      { id: ids.conn, org_id: org, provider: "meta", is_sandbox: false, status: "connected", token_sealed: sealed.token, page_token_sealed: sealed.page, account_ref: "100100", page_ref: "200200", scopes: [], token_expires_on: null, last_test_at: T, last_test: null, last_error: null, created_at: T, updated_at: T },
      { id: ids.hf, org_id: org, provider: "higgsfield", is_sandbox: false, status: "connected", token_sealed: sealed.hf, page_token_sealed: null, account_ref: null, page_ref: null, scopes: [], token_expires_on: null, last_test_at: null, last_test: null, last_error: null, created_at: T, updated_at: T },
    ],
    ads_campaigns: [{ id: ids.campaign, org_id: org, name: "Drivers wanted", state: "paused", state_changed_at: T, brief_source: "recruiting_opening", brief_ref: ids.campaign, brief_snapshot: {}, connection_id: ids.conn, brand_kit_id: ids.kit, settings_version_id: ids.settings, daily_budget_cents: null, lifetime_cap_cents: null, platform_refs: {}, last_error: null, created_at: T }],
    ads_creatives: [{ id: ids.creative, org_id: org, campaign_id: ids.campaign, preset_version_id: ids.preset, brand_kit_version_id: ids.kit, supersedes_id: null, state: "ready", copy: {}, assets: [], checks: {}, regenerations: 0, last_error: null, created_at: T }],
    ads_approvals: [{ id: ids.approval, org_id: org, campaign_id: ids.campaign, kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, withdraws_id: null, creative_id: null, approved_by: "u-admin", approved_by_name: "Admin", created_at: T }],
    ads_actions: [{ id: ids.action, org_id: org, campaign_id: ids.campaign, approval_id: null, kind: "connection_test", status: "succeeded", created_at: T }],
    ad_brand_kits: [{ id: ids.kit, org_id: org, name: "Our kit", archived_at: null, created_at: T }],
    ad_concept_presets: [{ id: ids.preset, org_id: org, key: "P1", enabled: true, archived_at: null, created_at: T }],
  };
}

const sealedValues: string[] = [];
const tables: Record<string, FixtureRow[]> = {};
for (const [org, ids] of [[ORG, MINE], [OTHER, THEIRS]] as const) {
  for (const [name, rows] of Object.entries(carrier(org, ids))) (tables[name] ??= []).push(...rows);
}

/** Reads filter as PostgREST does; an insert keeps its rows; an update changes the rows its filters match. */
function tableOf(name: string) {
  const rows = (tables[name] ??= []);
  return (q: RecordedQuery) => {
    if (q.write?.method === "insert") {
      const added = (Array.isArray(q.write.payload) ? q.write.payload : [q.write.payload]).map((r) => ({ id: randomUUID(), created_at: T, ...(r as FixtureRow) }));
      rows.push(...added);
      // `.insert(…).select(cols)` answers those columns only, as PostgREST does — or a column the service never
      // asked for would ride out by the fixture's generosity and the scrape would blame the service.
      return postgrestFixture(added)({ ...q, ops: q.ops.filter((o) => o.method === "select") });
    }
    if (q.write?.method === "update") {
      const hit = postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => !["select", "single", "maybeSingle"].includes(o.method)) });
      for (const h of hit) Object.assign(rows.find((r) => r.id === h.id)!, q.write.payload as object);
      return postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => o.method !== "update") });
    }
    return postgrestFixture(rows)(q);
  };
}

/**
 * Meta, at `fetch`: enough of the Graph for a connection test to save a row, and every error message carrying
 * the token it was sent — `access_token=…` is how Graph's own messages quote one.
 */
const realFetch = globalThis.fetch;
function graph(url: URL, init?: RequestInit): Response {
  const bearer = String(new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
  const echo = (code: number) => Response.json({ error: { code, message: `(#${code}) refused for access_token=${bearer}`, fbtrace_id: "trace" } }, { status: 400 });
  const path = url.pathname.replace(/^\/v[\d.]+\//, "");
  if (path === "me") return Response.json({ id: "9001", name: "Ads system user" });
  if (path === "me/permissions") return echo(100);
  if (path.startsWith("act_")) return Response.json({ id: path, name: "Ad account", account_status: 1, currency: "USD", spend_cap: "500000", amount_spent: "0" });
  if (path === "me/accounts") return Response.json({ data: [{ id: "200200", name: "Our Page", access_token: PAGE_TOKEN, tasks: ["ADVERTISE", "MODERATE"] }] });
  return echo(200);
}

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
const caller: AuthContext = { userId: "u-admin", email: "admin@x.test", orgId: ORG, role: "admin" };
/** Route key (as the walk names it) → status and body text. */
const answers = new Map<string, { status: number; text: string }>();

/** One call per route, with a body that reaches the handler where one is cheap to write. */
const SWEEP: Array<[string, string, unknown?]> = [
  ["GET /api/ads/settings", "settings"],
  ["PUT /api/ads/settings", "settings", { settings: LIVE_SETTINGS }],
  ["POST /api/ads/kill-switch", "kill-switch", { reason: "sweep" }],
  ["POST /api/ads/kill-switch/clear", "kill-switch/clear", { reason: "sweep" }],
  ["POST /api/ads/campaigns/:campaignId/approvals", `campaigns/${MINE.campaign}/approvals`, { kind: "launch", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }],
  ["GET /api/ads/connections", "connections"],
  ["POST /api/ads/connections/meta", "connections/meta", { token: TOKEN, account_id: "act_100100", page_id: "200200", sandbox: false }],
  ["POST /api/ads/connections/simulator", "connections/simulator", {}],
  ["POST /api/ads/connections/:connectionId/test", `connections/${MINE.conn}/test`, {}],
  ["POST /api/ads/connections/:connectionId/disconnect", `connections/${MINE.hf}/disconnect`, {}],
  ["GET /api/ads/brand-kits", "brand-kits"],
  ["GET /api/ads/presets", "presets"],
  ["POST /api/ads/brand-kits/assets/upload-url", "brand-kits/assets/upload-url", {}],
  ["POST /api/ads/brand-kits/assets", "brand-kits/assets", { upload_id: randomUUID() }],
  ["POST /api/ads/brand-kits", "brand-kits", { kit_id: MINE.kit, kit: {} }],
  ["POST /api/ads/presets", "presets", { key: "P1", enabled: true, recipe: {} }],
  ["GET /api/ads/campaigns", "campaigns"],
  ["GET /api/ads/campaigns/:campaignId", `campaigns/${MINE.campaign}`],
  ["POST /api/ads/campaigns", "campaigns", { id: randomUUID(), brief_source: "recruiting_opening", brief_ref: MINE.campaign, connection_id: MINE.conn, brand_kit_id: MINE.kit }],
  ["POST /api/ads/campaigns/:campaignId/launch", `campaigns/${MINE.campaign}/launch`, { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 }],
  // Launch before the archive move below: G-launch-gate's refusal is asserted on a paused campaign.
  ["POST /api/ads/campaigns/:campaignId/moves", `campaigns/${MINE.campaign}/moves`, { event: "archive", reason: "sweep" }],
  ["POST /api/ads/campaigns/:campaignId/creatives/:creativeId/decision", `campaigns/${MINE.campaign}/creatives/${MINE.creative}/decision`, { decision: "reject", reason: "sweep" }],
];

beforeAll(async () => {
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.hostname === "graph.facebook.com" ? Promise.resolve(graph(url, init)) : realFetch(input, init);
  });
  db = createSupabaseRecorder({
    tables: new Proxy({}, { get: (_t, name: string) => tableOf(name), has: () => true, ownKeys: () => [] }) as Record<string, never>,
    storage: { createSignedUploadUrl: (k: string) => ({ data: { signedUrl: `https://storage.test/${k}?sig=upload` }, error: null }), download: () => ({ data: null, error: { message: "Object not found" } }) },
  });
  holder.client = db.client;
  const app = createApp(env);
  app.locals.verifyToken = async () => caller;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
  for (const [key, path, body] of SWEEP) {
    const method = key.split(" ")[0]!;
    const res = await realFetch(`${baseUrl}/api/ads/${path}`, {
      method,
      headers: { Authorization: "Bearer session", "Content-Type": "application/json", [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, caller.userId, ORG)!.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    answers.set(key, { status: res.status, text: await res.text() });
  }
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeTestServer(server);
  await stopSimulatorForTests();
});

const everyAdsRoute = () => [...everyRoute().keys()].filter((k) => k.split(" ")[1]!.startsWith("/api/ads/"));

describe("Security L3 — the sweep reaches every ads route", () => {
  it("every /api/ads route the app serves was called once, and none answered a server error", () => {
    expect([...answers.keys()].sort()).toEqual(everyAdsRoute().sort());
    const failed = [...answers].filter(([, a]) => a.status >= 500).map(([k, a]) => `${k} → ${a.status} ${a.text}`);
    expect(failed).toEqual([]);
    // Not vacuous: the answers that carry what a leak would ride on came back whole.
    expect(answers.get("POST /api/ads/connections/meta")!.status).toBe(200);
    expect(answers.get("POST /api/ads/connections/:connectionId/test")!.status).toBe(200);
    expect(answers.get("GET /api/ads/connections")!.text).toContain(MINE.conn);
    expect(answers.get("GET /api/ads/campaigns")!.text).toContain(MINE.campaign);
  });

  it("Launch on a real connection answers the door's refusal through the app: its code, its sentence and every worker below L4", () => {
    const launch = answers.get("POST /api/ads/campaigns/:campaignId/launch")!;
    expect(launch.status).toBe(409);
    const body = JSON.parse(launch.text) as { error: { code: string; message: string }; missing: Array<{ worker: string; level: string; needs: string }> };
    expect(body.error.code).toBe("not_certified");
    expect(body.missing.map((m) => m.worker)).toEqual(ADS_CAMPAIGN_WORKERS["meta:still"]!.map((u) => u.worker));
    for (const m of body.missing) expect(body.error.message).toContain(m.worker);
  });
});

describe("Security L3 — a token in an API response", () => {
  it("no ads answer carries a token, key or secret — plain or sealed — or a sealed column, even when Meta echoes the token", () => {
    // Meta did echo it: the stub was asked with both tokens, so a missing scrub would have had something to leak.
    expect(answers.get("POST /api/ads/connections/meta")!.text).toContain("access_token=[token]");
    const secrets = [TOKEN, PAGE_TOKEN, HF_KEY, HF_KEY.split(":")[1]!, APP_SECRET, SEALING_KEY, ...sealedValues, "token_sealed", "page_token_sealed"];
    const leaks = [...answers].flatMap(([k, a]) => secrets.filter((s) => a.text.includes(s)).map((s) => `${k} carries ${s.slice(0, 24)}…`));
    expect(leaks).toEqual([]);
  });
});

describe("Security L3 — a cross-org read on every ads service query", () => {
  it("no answer names another carrier's row, and every query and write the routes made names this org", () => {
    const theirs = Object.values(THEIRS);
    const leaks = [...answers].flatMap(([k, a]) => theirs.filter((id) => a.text.includes(id)).map((id) => `${k} carries ${id}`));
    expect(leaks).toEqual([]);
    // user_profiles is keyed by the signed-in person, not an org: it is their own name for the ledger (memberLabels.ts).
    // jobs is the queue's own ledger, written by the id its enqueue just made (queue/dispatch.ts), not an ads read.
    expectOrgScoped(db, ORG, { exempt: ["user_profiles", "jobs"] });
  });
});
