import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_CAMPAIGN_WORKERS } from "@silvicom/shared";
import { loadEnv, type Env } from "../../../env.js";
import { seal, secretAad } from "../../../lib/secretBox.js";
import { campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { launchCampaign } from "../campaigns/campaignDoors.js";
import type { LaunchReadiness } from "../campaigns/launchCertification.js";
import { connectMeta } from "../connections/connections.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { metaTokenPurpose } from "../platforms/registry.js";
import { SANDBOX_ONLY_MESSAGE, sandboxAllowlist, sandboxOnlyVerdict } from "./sandboxOnly.js";

/**
 * D-AD8, "Staging spends nothing" (Q-AD42 ruled (a) AND (b), 2026-11-06): on a non-production host a Meta ad account is
 * used only when its id is on the host's allowlist AND Meta says it has no payment method. Proven three ways: the
 * rule itself, Connect (nothing stored when refused), and the launch door (an account connected before the rule).
 * Meta is stubbed at `fetch`, whose `act_<id>` answer carries `funding_source` when a case says the account can pay;
 * every other read answers as a healthy connection, so a refusal here is the rule's and nothing else's.
 */

const STAGING = { DEPLOY_ENVIRONMENT: "staging" };
const PRODUCTION = { DEPLOY_ENVIRONMENT: "production", NODE_ENV: "production" };
const SANDBOX = "100100";
const REAL = "200200";
const TOKEN = "EAAGsandboxonlytokenAAAA1111222233334444";
const C = "70000000-0000-4000-8000-000000000001";
const ASK = { daily_budget_cents: 5_000, lifetime_cap_cents: 50_000 };

const envWith = (ids: string | undefined): Env =>
  loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), ...(ids === undefined ? {} : { META_SANDBOX_AD_ACCOUNT_IDS: ids }) } as NodeJS.ProcessEnv);

/** Which accounts Meta says have a payment method. */
let paying = new Set<string>();
let accountReads: string[] = [];
const realFetch = globalThis.fetch;
function meta(url: URL): Response {
  const path = url.pathname.replace(/^\/v[\d.]+\//, "");
  if (path === "me") return Response.json({ id: "9001", name: "System user" });
  if (path === "me/permissions") return Response.json({ data: ["ads_management", "ads_read", "leads_retrieval", "pages_manage_metadata", "pages_read_engagement", "pages_show_list"].map((permission) => ({ permission, status: "granted" })) });
  if (path.startsWith("act_")) {
    const id = path.slice(4);
    accountReads.push(`${id}:${url.searchParams.get("fields")}`);
    return Response.json({ id: path, name: "Ad account", account_status: 1, currency: "USD", spend_cap: "500000", amount_spent: "0", ...(paying.has(id) ? { funding_source: "6011223344556677" } : {}) });
  }
  if (path === "me/accounts") return Response.json({ data: [{ id: "300300", name: "Our Page", access_token: "EAAGpagetokenBBBB5555", tasks: ["ADVERTISE", "MODERATE"] }] });
  if (path.endsWith("/subscribed_apps")) return Response.json({ success: true });
  return Response.json({ error: { code: 100, message: "unknown" } }, { status: 400 });
}

beforeEach(() => {
  resetGraphThrottles();
  paying = new Set();
  accountReads = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.hostname === "graph.facebook.com" ? Promise.resolve(meta(url)) : realFetch(input, init);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A graph that records every read: the rule must not read on production or for an unlisted account. */
const graphOf = (fundingSource?: string) => {
  const reads: string[] = [];
  return {
    reads,
    open: async () => ({ get: async (path: string) => { reads.push(path); return { ok: true as const, data: (fundingSource === undefined ? {} : { funding_source: fundingSource }) as never, usage: null, attempts: 1 }; } }),
  };
};

describe("D-AD8 — the rule (guard/sandboxOnly.ts)", () => {
  it("on a non-production host, a listed account Meta says has no payment method is used", async () => {
    const g = graphOf();
    expect(await sandboxOnlyVerdict({ env: envWith(SANDBOX), processEnv: STAGING }, "meta", SANDBOX, g.open)).toEqual({ ok: true, checked: true });
    expect(g.reads).toEqual([`act_${SANDBOX}`]);
  });

  it("listed but Meta says it has a payment method: refused, naming the rule", async () => {
    const out = await sandboxOnlyVerdict({ env: envWith(SANDBOX), processEnv: STAGING }, "meta", SANDBOX, graphOf("6011").open);
    expect(out).toMatchObject({ ok: false, refusal: "account_can_pay" });
    expect((out as { message: string }).message).toContain(SANDBOX_ONLY_MESSAGE);
  });

  it("unlisted, even with no payment method: refused without asking Meta", async () => {
    const g = graphOf();
    expect(await sandboxOnlyVerdict({ env: envWith(SANDBOX), processEnv: STAGING }, "meta", REAL, g.open)).toMatchObject({ ok: false, refusal: "sandbox_not_listed" });
    expect(g.reads).toEqual([]);
  });

  it("an empty or missing allowlist refuses every Meta account", async () => {
    for (const ids of [undefined, "", " , "]) {
      expect(await sandboxOnlyVerdict({ env: envWith(ids), processEnv: STAGING }, "meta", SANDBOX, graphOf().open), String(ids)).toMatchObject({ ok: false, refusal: "sandbox_not_listed" });
    }
  });

  it("an account nobody can ask about (the read fails, or the token cannot be opened) is refused", async () => {
    const failing = async () => ({ get: async () => ({ ok: false as const, error: { kind: "network", error_code: "network" } as never }) });
    expect(await sandboxOnlyVerdict({ env: envWith(SANDBOX), processEnv: STAGING }, "meta", SANDBOX, failing)).toMatchObject({ ok: false, refusal: "account_unreadable" });
    expect(await sandboxOnlyVerdict({ env: envWith(SANDBOX), processEnv: STAGING }, "meta", SANDBOX, async () => null)).toMatchObject({ ok: false, refusal: "account_unreadable" });
  });

  it("production is unchanged: any account, listed or not, paying or not, and nothing is read", async () => {
    for (const processEnv of [PRODUCTION, { NODE_ENV: "production" }]) {
      const g = graphOf("6011");
      expect(await sandboxOnlyVerdict({ env: envWith(undefined), processEnv }, "meta", REAL, g.open)).toEqual({ ok: true, checked: false });
      expect(g.reads).toEqual([]);
    }
  });

  it("the allowlist takes ids with or without act_, and a simulator connection is its own gate's", async () => {
    expect(sandboxAllowlist(envWith(`act_${SANDBOX}, 300300 ,`))).toEqual([SANDBOX, "300300"]);
    expect(await sandboxOnlyVerdict({ env: envWith(undefined), processEnv: STAGING }, "simulator", "990000000001", graphOf("6011").open)).toEqual({ ok: true, checked: false });
  });
});

describe("D-AD8 — at Connect (connections/connections.ts)", () => {
  let db: SupabaseRecorder;
  beforeEach(() => {
    db = createSupabaseRecorder({ tables: {
      ads_platform_connections: (q) => (q.write?.method === "insert" ? [{ id: "c-new", provider: "meta", ...(q.write.payload as object) }] : []),
      ads_campaigns: [], ads_actions: [{ id: "a-1" }], audit_logs: [{ id: "au-1" }],
    } });
  });
  const connect = (accountId: string, env: Env, processEnv: NodeJS.ProcessEnv) =>
    connectMeta({ admin: db.client, env, processEnv, now: () => new Date("2026-11-06T18:00:00Z") }, ORG, { id: "u-admin", name: "Admin" }, { token: TOKEN, account_id: accountId, page_id: "300300", sandbox: true });
  const stored = () => db.queries.filter((q) => q.write && q.table === "ads_platform_connections");

  it("staging + a real (paying) account: refused in the rule's words, and nothing is sealed or stored", async () => {
    paying.add(REAL);
    const out = await connect(REAL, envWith(REAL), STAGING);
    expect(out).toMatchObject({ kind: "refused", error_code: "account_can_pay" });
    expect((out as { reason: string }).reason).toContain(SANDBOX_ONLY_MESSAGE);
    expect(stored()).toEqual([]);
  });

  it("staging + an unlisted account: refused, nothing stored", async () => {
    expect(await connect(REAL, envWith(SANDBOX), STAGING)).toMatchObject({ kind: "refused", error_code: "sandbox_not_listed" });
    expect(stored()).toEqual([]);
  });

  it("staging + the listed sandbox Meta says cannot pay: connected, after reading its payment method from Meta", async () => {
    expect(await connect(SANDBOX, envWith(SANDBOX), STAGING)).toMatchObject({ kind: "saved" });
    expect(accountReads).toContain(`${SANDBOX}:funding_source`);
    expect(stored()).toHaveLength(1);
  });

  it("production + a real paying account: connected as before, and the payment method is never asked", async () => {
    paying.add(REAL);
    expect(await connect(REAL, envWith(undefined), PRODUCTION)).toMatchObject({ kind: "saved" });
    expect(accountReads.some((r) => r.endsWith(":funding_source"))).toBe(false);
  });
});

describe("D-AD8 — at Launch (campaigns/campaignDoors.ts), for an account connected before the rule", () => {
  let w: AdsWorld;
  const ALL_L4: LaunchReadiness = {
    workers: ADS_CAMPAIGN_WORKERS,
    levels: Object.fromEntries(ADS_CAMPAIGN_WORKERS["meta:still"]!.map((u) => [u.platform ? `${u.worker}|${u.platform}` : u.worker, "L4" as const])),
  };
  const world = (account: string, env: Env) => {
    const token_sealed = seal(env, TOKEN, secretAad(ORG, metaTokenPurpose(false)));
    const approval = { id: "ap-1", org_id: ORG, campaign_id: C, kind: "launch", withdraws_id: null, approved_by: "u-admin", approved_by_name: "Owner", ...ASK, created_at: "2026-11-02T11:00:00Z" };
    w = createAdsWorld({
      campaigns: [campaign(C, "paused", { daily_budget_cents: null, lifetime_cap_cents: null })], approvals: [approval],
      connections: [{ id: CONN, org_id: ORG, provider: "meta", is_sandbox: false, status: "connected", token_sealed, account_ref: account }],
    });
  };
  // Every worker at L4, so a refusal here can only be the sandbox rule's.
  const launch = (env: Env, processEnv: NodeJS.ProcessEnv) => launchCampaign(w.admin, ORG, { id: "u-admin", name: "Owner" }, C, ASK, new Date("2026-11-06T18:00:00Z"), ALL_L4, { env, processEnv });

  it("staging + a real (paying) account: refused in the rule's words, the campaign stays paused and says why", async () => {
    const env = envWith(REAL);
    paying.add(REAL);
    world(REAL, env);
    const out = await launch(env, STAGING);
    expect(out).toMatchObject({ kind: "launch_refused", refusal: "account_can_pay", missing: [] });
    expect(w.byId(C)).toMatchObject({ state: "paused", last_error: (out as { message: string }).message });
    expect((out as { message: string }).message).toContain(SANDBOX_ONLY_MESSAGE);
  });

  it("staging + an unlisted account: refused before any approval is read", async () => {
    const env = envWith(SANDBOX);
    world(REAL, env);
    expect(await launch(env, STAGING)).toMatchObject({ kind: "launch_refused", refusal: "sandbox_not_listed" });
    expect(w.rec.forTable("ads_approvals")).toHaveLength(0);
  });

  it("staging + the listed sandbox Meta says cannot pay: the launch goes ahead", async () => {
    const env = envWith(SANDBOX);
    world(SANDBOX, env);
    expect(await launch(env, STAGING)).toEqual({ kind: "moved", to: "launching" });
  });

  it("production + a real paying account: launches as before, and the payment method is never asked", async () => {
    const env = envWith(undefined);
    paying.add(REAL);
    world(REAL, env);
    expect(await launch(env, PRODUCTION)).toEqual({ kind: "moved", to: "launching" });
    expect(accountReads).toEqual([]);
  });
});
