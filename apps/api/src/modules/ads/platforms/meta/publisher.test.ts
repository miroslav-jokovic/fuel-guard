import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAdName } from "@silvicom/shared";
import { expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { campaign, CONN, createAdsWorld, ORG, type AdsWorld } from "../../../../testing/adsWorld.js";
import { FakeMeta } from "../simulator/fakeMeta.js";
import { MetaGraph, resetGraphThrottles } from "./graphClient.js";
import { nameFor, publishCampaignAndAdSet, type PublishInput } from "./publisher.js";

/**
 * The Meta publisher's first half (B2a) against FakeMeta over real HTTP and the stateful ads world.
 * L1: what it sends, and what it refuses before sending. L2 (§4R, Publisher row): 429/5xx/timeout on
 * each create step, a half-created campaign resumed and never duplicated, a revoked token, a crash
 * between a create and its ledger row, and the same step delivered twice at once.
 */
const TOKEN = "EAAB-publisher-token-0123456789";
const ACCOUNT = "2001";
const PAGE = "3001";
const CAMPAIGN = "ab12cd34-0000-4000-8000-000000000001";

let meta: FakeMeta;
let base: string;
let w: AdsWorld;

beforeEach(async () => {
  resetGraphThrottles();
  meta = new FakeMeta({ token: TOKEN, accounts: [{ id: ACCOUNT, spend_cap_cents: 300_000, amount_spent_cents: 0, account_status: 1, currency: "USD" }] });
  base = await meta.start();
  w = createAdsWorld({ campaigns: [campaign(CAMPAIGN, "creating")] });
});
afterEach(() => meta.stop());

const input = (patch: Partial<PublishInput> = {}): PublishInput => ({
  orgId: ORG, campaignId: CAMPAIGN, connectionId: CONN, accountId: ACCOUNT, pageId: PAGE, platform: "meta",
  brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-02T15:00:00Z",
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${CAMPAIGN}:stint-1`, ...patch,
});

const graph = () => new MetaGraph({ token: TOKEN, throttleKey: "conn-pub", baseUrl: base, timeoutMs: 300, sleep: async () => {} });
const publish = (patch: Partial<PublishInput> = {}) => publishCampaignAndAdSet({ admin: w.admin, graph: graph(), now: w.now }, input(patch));
const posts = (re: RegExp) => meta.requests.filter((r) => r.method === "POST" && re.test(r.path)).length;
const creates = () => w.actions.filter((a) => a.kind === "create_paused");

describe("Meta publisher (B2a) — what it sends", () => {
  it("creates a paused EMPLOYMENT campaign in the US with the spend cap, then a paused lead ad set on the Page, each read back", async () => {
    const r = await publish();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = meta.campaigns.get(r.platform_refs.meta_campaign_id)!;
    expect(c).toMatchObject({ status: "PAUSED", objective: "OUTCOME_LEADS", special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "50000" });
    const a = meta.adsets.get(r.platform_refs.meta_adset_id)!;
    expect(a).toMatchObject({ campaign_id: c.id, status: "PAUSED", daily_budget: "5000", optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: { page_id: PAGE } });
    expect(creates().map((x) => [x.request && (x.request as { level: string }).level, x.status])).toEqual([["campaign", "succeeded"], ["adset", "succeeded"]]);
    expectOrgScoped(w.rec, ORG);
  });

  it("the ad set targets a pin and a radius and nothing else — no age, gender, ZIP or exclusion is ever sent", async () => {
    const r = await publish();
    if (!r.ok) throw new Error(r.error_code);
    const t = meta.adsets.get(r.platform_refs.meta_adset_id)!.targeting;
    expect(t).toEqual({ geo_locations: { custom_locations: [{ latitude: 41.525, longitude: -88.0817, radius: 25, distance_unit: "mile" }] } });
  });

  it("names come from naming.ts, the same on every attempt; a simulator connection's objects read SIM", async () => {
    const a = nameFor(input(), "campaign");
    expect(nameFor(input({ key: "other-stint" }), "campaign")).toBe(a);
    expect(parseAdName(a)).toMatchObject({ platform: "meta", level: "campaign", preset_key: "ALL", day: "2026-11-02", campaign_short: "ab12cd34" });
    expect(parseAdName(nameFor(input({ platform: "simulator" }), "adset"))).toMatchObject({ platform: "simulator", level: "adset" });
    // 03:00Z on the 3rd is still the 2nd in Chicago: the name's day is the org's, not UTC's.
    expect(parseAdName(nameFor(input({ created_at: "2026-11-03T03:00:00Z" }), "campaign"))?.day).toBe("2026-11-02");
  });

  it.each([
    ["budget_unset", { daily_budget_cents: null }],
    ["spend_cap_below_meta_minimum", { lifetime_cap_cents: 9_999 }],
    ["area_outside_meta_limits", { area: { ...input().area, radius_miles: 51 } }],
    ["area_invalid", { area: { ...input().area, radius_miles: 14 } }],
    ["connection_incomplete", { pageId: "" }],
  ] as const)("refuses before calling Meta: %s — a refused row, and no request at all", async (code, patch) => {
    const r = await publish(patch as Partial<PublishInput>);
    expect(r).toEqual({ ok: false, error_code: code });
    expect(meta.requests).toHaveLength(0);
    expect(creates().map((x) => [x.status, x.error_code])).toEqual([["refused", code]]);
  });

  it("FakeMeta holds Meta's employment rules: age, gender or a radius under 15 miles is a hard 2909035", async () => {
    const g = graph();
    const c = await g.post<{ id: string }>(`act_${ACCOUNT}/campaigns`, { name: "x", status: "PAUSED", special_ad_categories: ["EMPLOYMENT"], spend_cap: 50_000 }, { idempotent: false });
    if (!c.ok) throw new Error("campaign");
    const adset = (targeting: Record<string, unknown>) => g.post(`act_${ACCOUNT}/adsets`, {
      name: "y", campaign_id: c.data.id, status: "PAUSED", daily_budget: 5_000, billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION", promoted_object: { page_id: PAGE }, targeting,
    }, { idempotent: false });
    const geo = (radius: number) => ({ geo_locations: { custom_locations: [{ latitude: 41.5, longitude: -88, radius, distance_unit: "mile" }] } });
    for (const t of [{ ...geo(25), age_min: 23 }, { ...geo(25), genders: [1] }, geo(10)]) {
      const r = await adset(t);
      expect(r.ok ? null : r.error.error_code).toBe("meta_2909035");
    }
    expect((await adset(geo(25))).ok).toBe(true);
  });
});

describe("Meta publisher (B2a) — resume, never duplicate (§4R Publisher L2)", () => {
  it("a create Meta applied but answered 5xx is found by its name and taken, never sent twice", async () => {
    meta.inject("POST", /campaigns$/, { kind: "applied_then_temporary" });
    const r = await publish();
    expect(r.ok).toBe(true);
    expect(posts(/campaigns$/)).toBe(1);
    expect(meta.campaigns.size).toBe(1);
    expect(creates()[0]).toMatchObject({ status: "succeeded", response: { resumed: true } });
  });

  it("half-created (campaign yes, ad set no): the next attempt adopts the campaign and creates only the ad set", async () => {
    meta.inject("POST", /adsets$/, { kind: "hang" });
    const first = await publish();
    expect(first).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 0]);

    const second = await publish({ key: `${CAMPAIGN}:stint-2` });
    expect(second.ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 1]);
    expect(posts(/campaigns$/)).toBe(1);
    const stint2 = creates().filter((a) => String(a.idempotency_key).includes("stint-2"));
    expect(stint2.map((a) => a.response)).toEqual([{ adopted: true }, null]);
  });

  it.each([
    ["the campaign create", /campaigns$/, [0, 0]],
    ["the ad set create", /adsets$/, [1, 0]],
  ] as const)("a 429 on %s stops the step as rate_limited and sends nothing after it", async (_label, path, sizes) => {
    meta.inject("POST", path, { kind: "throttle", regainMinutes: 3 });
    const r = await publish();
    expect(r).toMatchObject({ ok: false, error_code: "rate_limited" });
    expect([meta.campaigns.size, meta.adsets.size]).toEqual(sizes);
    expect(posts(/adsets$/)).toBe(path.source.includes("adsets") ? 1 : 0);
  });

  it.each([
    ["a timeout", { kind: "hang" } as const],
    ["a 5xx that did not apply", { kind: "temporary" } as const],
  ])("%s on the campaign create is an unknown outcome: one create sent, and the next stint creates exactly one", async (_l, fault) => {
    meta.inject("POST", /campaigns$/, fault);
    expect(await publish()).toEqual({ ok: false, error_code: "create_outcome_unknown" });
    expect(posts(/campaigns$/)).toBe(1);
    expect((await publish({ key: `${CAMPAIGN}:stint-2` })).ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size]).toEqual([1, 1]);
  });

  it("a revoked token stops the step at its first read: token_invalid, and no create is sent", async () => {
    meta.revokeToken();
    expect(await publish()).toMatchObject({ ok: false, error_code: "token_invalid" });
    expect(posts(/./)).toBe(0);
  });

  it("a crash between a create and its ledger row: the next delivery adopts the object and never creates a second", async () => {
    w.crashOnWrite("ads_actions", 2); // write 1 starts the campaign row, write 2 would complete it
    await expect(publish()).rejects.toThrow(/injected crash/);
    expect(meta.campaigns.size).toBe(1);
    const again = await publish();
    expect(again.ok).toBe(true);
    expect([meta.campaigns.size, meta.adsets.size, posts(/campaigns$/)]).toEqual([1, 1, 1]);
    expect(creates().every((a) => a.status === "succeeded")).toBe(true);
  });

  it("the same step delivered twice at once creates each object once", async () => {
    const [a, b] = await Promise.all([publish(), publish()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([meta.campaigns.size, meta.adsets.size, posts(/campaigns$/), posts(/adsets$/)]).toEqual([1, 1, 1, 1]);
  });

  it("two objects carrying our name are refused, never a guess; one found active is refused, never adopted", async () => {
    const name = nameFor(input(), "campaign");
    const twin = (id: string, status: "PAUSED" | "ACTIVE") => meta.campaigns.set(id, {
      id, account_id: ACCOUNT, name, objective: "OUTCOME_LEADS", status, special_ad_categories: ["EMPLOYMENT"],
      special_ad_category_country: ["US"], spend_cap: "50000", daily_budget: null,
    });
    twin("900", "ACTIVE");
    expect(await publish()).toMatchObject({ ok: false, error_code: "found_not_paused" });
    twin("901", "PAUSED");
    expect(await publish({ key: "k2" })).toMatchObject({ ok: false, error_code: "duplicate_on_platform" });
    expect(posts(/./)).toBe(0);
  });
});
