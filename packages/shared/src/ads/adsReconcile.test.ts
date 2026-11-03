import { describe, expect, it } from "vitest";
import { reconcile, type MetaObjectSeen, type ReconcileOurCampaign } from "./adsReconcile.js";
import { buildAdName } from "./naming.js";

/**
 * B5c's comparison. §4R Monitor L3: "reconcile flags every planted mismatch and nothing else". Every test
 * starts from a world where the two sides agree and plants exactly one difference.
 */

const OUR_NAME = buildAdName({ platform: "meta", level: "campaign", brief_source: "recruiting_opening", brief_ref: "op-1@v3", preset_key: "ALL", day: "2026-11-02", campaign_short: "ab12cd34" });
const ours = (over: Partial<ReconcileOurCampaign> = {}): ReconcileOurCampaign => ({
  campaign_id: "c1", state: "live", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000,
  meta_campaign_id: "m1", meta_adset_id: "s1", lifetime_spend_cents: 10_000, ...over,
});
const seen = (id: string, status: string | null, amount_cents: number | null, name: string | null = OUR_NAME): MetaObjectSeen => ({ id, name, status, amount_cents });

/** The agreeing world for `ours()`, with any object replaced. */
function world(c: ReconcileOurCampaign = ours(), patch: { m1?: MetaObjectSeen | null; s1?: MetaObjectSeen | null; account?: MetaObjectSeen[] } = {}) {
  const objects = new Map<string, MetaObjectSeen>();
  const m1 = patch.m1 === undefined ? seen("m1", c.state === "live" ? "ACTIVE" : "PAUSED", 50_000) : patch.m1;
  const s1 = patch.s1 === undefined ? seen("s1", "ACTIVE", 5_000) : patch.s1;
  if (m1) objects.set("m1", m1);
  if (s1) objects.set("s1", s1);
  return reconcile({ ours: [c], objects, account_campaigns: patch.account ?? (m1 ? [m1] : []) });
}
const fields = (r: ReturnType<typeof reconcile>) => r.map((m) => [m.level, m.field, m.ours, m.theirs, m.severity]);

describe("reconcile — every planted mismatch and nothing else (B5c, D-AD4)", () => {
  it("two sides that agree flag nothing — live, paused, and moves in flight either way", () => {
    expect(world()).toEqual([]);
    expect(world(ours({ state: "paused" }))).toEqual([]);
    for (const state of ["launching", "pausing"] as const) {
      expect(world(ours({ state }), { m1: seen("m1", "ACTIVE", 50_000) })).toEqual([]);
      expect(world(ours({ state }), { m1: seen("m1", "PAUSED", 50_000) })).toEqual([]);
    }
  });

  it("an Ads-Manager status change: ACTIVE where we hold it paused is critical; PAUSED where we run it is a warning", () => {
    expect(fields(world(ours({ state: "paused" }), { m1: seen("m1", "ACTIVE", 50_000) }))).toEqual([["campaign", "status", "PAUSED", "ACTIVE", "critical"]]);
    expect(fields(world(ours(), { m1: seen("m1", "PAUSED", 50_000) }))).toEqual([["campaign", "status", "ACTIVE", "PAUSED", "warning"]]);
    expect(fields(world(ours(), { s1: seen("s1", "PAUSED", 5_000) }))).toEqual([["adset", "status", "ACTIVE", "PAUSED", "warning"]]);
  });

  it("a paused campaign's ad set may stay ACTIVE: our pause stops the campaign alone", () => {
    expect(world(ours({ state: "paused" }), { s1: seen("s1", "ACTIVE", 5_000) })).toEqual([]);
    // …and a campaign created paused has its ad set PAUSED too: neither is owed ACTIVE until it is live.
    expect(world(ours({ state: "paused" }), { s1: seen("s1", "PAUSED", 5_000) })).toEqual([]);
  });

  it("amounts: raised or removed is critical, lowered is a warning — for the ad set's daily budget and the campaign's cap", () => {
    expect(fields(world(ours(), { s1: seen("s1", "ACTIVE", 5_001) }))).toEqual([["adset", "daily_budget", 5_000, 5_001, "critical"]]);
    expect(fields(world(ours(), { s1: seen("s1", "ACTIVE", 4_000) }))).toEqual([["adset", "daily_budget", 5_000, 4_000, "warning"]]);
    expect(fields(world(ours(), { s1: seen("s1", "ACTIVE", null) }))).toEqual([["adset", "daily_budget", 5_000, null, "critical"]]);
    expect(fields(world(ours(), { m1: seen("m1", "ACTIVE", null) }))).toEqual([["campaign", "spend_cap", 50_000, null, "critical"]]);
    expect(fields(world(ours(), { m1: seen("m1", "ACTIVE", 49_999) }))).toEqual([["campaign", "spend_cap", 50_000, 49_999, "warning"]]);
  });

  it("an overrun: lifetime spend a cent past the approved lifetime, and not at it", () => {
    expect(world(ours({ lifetime_spend_cents: 50_000 }))).toEqual([]);
    expect(fields(world(ours({ lifetime_spend_cents: 50_001 })))).toEqual([["campaign", "overrun", 50_000, 50_001, "critical"]]);
  });

  it("missing: deleted, archived or gone at Meta is reported, unless we archived it too; a gone campaign says nothing about its ad set", () => {
    for (const m1 of [null, seen("m1", null, null), seen("m1", "DELETED", 50_000), seen("m1", "ARCHIVED", 50_000)]) {
      expect(fields(world(ours(), { m1, account: [] }))).toEqual([["campaign", "missing", "live", m1?.status ?? null, "warning"]]);
    }
    expect(world(ours({ state: "archived" }), { m1: seen("m1", "ARCHIVED", 50_000) })).toEqual([]);
    expect(fields(world(ours(), { s1: null }))).toEqual([["adset", "missing", "live", null, "warning"]]);
  });

  it("a campaign someone made in Ads Manager is reported, never adopted — critical while it delivers; a name of ours without our row is marked", () => {
    const stranger = seen("x9", "ACTIVE", null, "Spring hiring — manual");
    const r = world(ours(), { account: [seen("m1", "ACTIVE", 50_000), stranger, seen("x8", "PAUSED", null, "old test"), seen("x7", "DELETED", null, "gone")] });
    expect(r.map((m) => [m.meta_id, m.field, m.campaign_id, m.ours, m.severity])).toEqual([["x9", "not_ours", null, null, "critical"], ["x8", "not_ours", null, null, "warning"]]);
    const lost = world(ours(), { account: [seen("m1", "ACTIVE", 50_000), seen("x6", "PAUSED", null, OUR_NAME)] });
    expect(lost.map((m) => [m.meta_id, m.ours])).toEqual([["x6", "ours_by_name_unrecorded"]]);
  });

  it("the key names one fact: the same edit keeps its key, a new value on the same field gets a new one, an overrun keeps its key as spend climbs", () => {
    const key = (s1: number) => world(ours(), { s1: seen("s1", "ACTIVE", s1) })[0]!.key;
    expect([key(6_000), key(6_000), key(7_000)]).toEqual(["adset:s1:daily_budget:6000", "adset:s1:daily_budget:6000", "adset:s1:daily_budget:7000"]);
    const over = (spend: number) => world(ours({ lifetime_spend_cents: spend }))[0]!.key;
    expect([over(50_001), over(60_000)]).toEqual(["campaign:m1:overrun:50000", "campaign:m1:overrun:50000"]);
  });
});
