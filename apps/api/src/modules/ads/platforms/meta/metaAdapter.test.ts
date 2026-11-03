import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlatformCampaignRef, SpendCall } from "../adapter.js";
import { FakeMeta } from "../simulator/fakeMeta.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { metaAdapter } from "./metaAdapter.js";

/**
 * The Meta adapter's contract (B3) against FakeMeta over HTTP: pause is the campaign alone; launch sets
 * the approved amounts, then the ads and the ad set, and the campaign LAST, so a launch that fails part
 * way leaves the master switch off; every answer is read back from Meta.
 */
const TOKEN = "EAAB-adapter-token-0123456789";
const ACCOUNT = "4001";
let meta: FakeMeta;
let base: string;

const ref = (patch: Record<string, unknown> = {}): PlatformCampaignRef => ({
  campaign_id: "c1", platform: "meta", platform_refs: { meta_campaign_id: "500", meta_adset_id: "501", meta_ad_ids: ["502"], ...patch },
});
const call = (patch: Partial<SpendCall> = {}): SpendCall => ({ campaign: ref(), daily_budget_cents: 7_500, lifetime_cap_cents: 60_000, idempotency_key: "launch:appr-1", ...patch });

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: ACCOUNT, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }] });
  base = await meta.start();
  meta.campaigns.set("500", { id: "500", account_id: ACCOUNT, name: "S360|c", objective: "OUTCOME_LEADS", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null });
  meta.sets.adsets.set("501", { id: "501", account_id: ACCOUNT, campaign_id: "500", name: "S360|a", status: "PAUSED", daily_budget: "5000", billing_event: "IMPRESSIONS", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: "1" }, targeting: {} });
  meta.sets.ads.set("502", { id: "502", adset_id: "501", name: "S360|ad", status: "PAUSED" });
});
afterEach(() => meta.stop());

const adapter = () => metaAdapter({ graph: new MetaGraph({ token: TOKEN, throttleKey: "conn-ad", baseUrl: base, timeoutMs: 300, sleep: async () => {} }), accountId: ACCOUNT });
const writes = () => meta.requests.filter((r) => r.method === "POST").map((r) => `${r.path.split("/").pop()}:${Object.entries(r.body).map(([k, v]) => `${k}=${v}`).join("&")}`);

describe("Meta adapter (B3) — pause", () => {
  it("pause sets the campaign alone to PAUSED and answers from Meta's read-back; pausing a paused campaign succeeds", async () => {
    meta.campaigns.get("500")!.status = "ACTIVE";
    expect(await adapter().safe.pause({ campaign: ref(), idempotency_key: "pause:k" })).toMatchObject({ ok: true, response: { status: "PAUSED" } });
    expect(writes()).toEqual(["500:status=PAUSED"]);
    expect(meta.sets.adsets.get("501")!.status).toBe("PAUSED");
    expect((await adapter().safe.pause({ campaign: ref(), idempotency_key: "pause:k" })).ok).toBe(true);
  });

  it("a 5xx on the pause is retried — it sets a value, so twice is once — and the campaign ends paused", async () => {
    meta.campaigns.get("500")!.status = "ACTIVE";
    meta.inject("POST", /^500$/, { kind: "temporary" });
    expect((await adapter().safe.pause({ campaign: ref(), idempotency_key: "pause:k" })).ok).toBe(true);
    expect(meta.campaigns.get("500")!.status).toBe("PAUSED");
  });

  it("Meta answering success without applying it is caught by the read-back: pause_not_applied, launch_not_applied", async () => {
    meta.campaigns.get("500")!.status = "ACTIVE";
    meta.inject("POST", /^500$/, { kind: "accepted_not_applied" });
    expect(await adapter().safe.pause({ campaign: ref(), idempotency_key: "k" })).toMatchObject({ ok: false, error_code: "pause_not_applied" });
    meta.campaigns.get("500")!.status = "PAUSED";
    meta.inject("POST", /^500$/, { kind: "accepted_not_applied" }, 2);
    expect(await adapter().spend.launch(call())).toMatchObject({ ok: false, error_code: "launch_not_applied" });
  });

  it("a revoked token stops the pause as token_invalid, and a campaign with no Meta ids is refused without a call", async () => {
    meta.revokeToken();
    expect(await adapter().safe.pause({ campaign: ref(), idempotency_key: "k" })).toMatchObject({ ok: false, error_code: "token_invalid" });
    expect(await adapter().safe.pause({ campaign: ref({ meta_campaign_id: undefined }), idempotency_key: "k" })).toEqual({ ok: false, error_code: "no_platform_ref" });
  });
});

describe("Meta adapter (B3) — launch, raise, area", () => {
  it("launch sets the approved amounts, then the ad and the ad set ACTIVE, and the campaign LAST, read back ACTIVE", async () => {
    expect(await adapter().spend.launch(call())).toMatchObject({ ok: true, response: { status: "ACTIVE" } });
    expect(writes()).toEqual(["501:daily_budget=7500", "500:spend_cap=60000", "502:status=ACTIVE", "501:status=ACTIVE", "500:status=ACTIVE"]);
    expect([meta.campaigns.get("500")!.status, meta.sets.adsets.get("501")!.status, meta.sets.ads.get("502")!.status]).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
  });

  it("a launch that fails part way leaves the campaign PAUSED: the master switch is never reached", async () => {
    meta.inject("POST", /^501$/, { kind: "throttle" }, 5);
    const r = await adapter().spend.launch(call());
    expect(r).toMatchObject({ ok: false, error_code: "rate_limited", response: { step: "adset_budget" } });
    expect(meta.campaigns.get("500")!.status).toBe("PAUSED");
    expect(writes().some((w) => w === "500:status=ACTIVE")).toBe(false);
  });

  it("a launch with no ad is refused before any call: an active campaign with nothing to show would only look live", async () => {
    expect(await adapter().spend.launch(call({ campaign: ref({ meta_ad_ids: [] }) }))).toEqual({ ok: false, error_code: "no_ad_on_platform" });
    expect(meta.requests).toHaveLength(0);
  });

  it("raise sets the ad set's daily budget only; an area change keeps Meta's 15–50 mile window", async () => {
    expect((await adapter().spend.raiseDailyBudget(call({ daily_budget_cents: 9_000 }))).ok).toBe(true);
    expect(meta.sets.adsets.get("501")!.daily_budget).toBe("9000");
    const area = { label: "Gary", latitude: 41.6, longitude: -87.3, radius_miles: 40, reason: "New yard in Gary opens in December" };
    expect((await adapter().spend.changeArea({ campaign: ref(), area, idempotency_key: "k" })).ok).toBe(true);
    expect(meta.sets.adsets.get("501")!.targeting).toEqual({ geo_locations: { custom_locations: [{ latitude: 41.6, longitude: -87.3, radius: 40, distance_unit: "mile" }] } });
    expect(await adapter().spend.changeArea({ campaign: ref(), area: { ...area, radius_miles: 60 }, idempotency_key: "k" })).toEqual({ ok: false, error_code: "area_outside_meta_limits" });
  });

  it("this month's spend is the account's insights, read in dollars and answered in cents; nothing spent is 0 and an unreadable account is unknown", async () => {
    const range = { since: "2026-11-01", until: "2026-11-15" };
    expect(await adapter().safe.readSpendCents(range)).toBe(0);
    meta.accounts.get(ACCOUNT)!.month_spend_cents = 140_001;
    expect(await adapter().safe.readSpendCents(range)).toBe(140_001);
    expect(meta.requests.at(-1)).toMatchObject({ method: "GET", path: expect.stringMatching(/\/act_\d+\/insights$/), body: { fields: "spend", level: "account", time_range: JSON.stringify(range) } });
    meta.revokeToken();
    expect(await adapter().safe.readSpendCents(range)).toBeNull();
  });

  it("the account limit is Meta's spend_cap now; \"0\" (no limit) and an unreadable account are unknown, never unlimited", async () => {
    expect(await adapter().safe.readAccountLimitCents()).toBe(300_000);
    meta.accounts.get(ACCOUNT)!.spend_cap_cents = 0;
    expect(await adapter().safe.readAccountLimitCents()).toBeNull();
    meta.revokeToken();
    expect(await adapter().safe.readAccountLimitCents()).toBeNull();
  });
});
