import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testEnv } from "../../../testing/testEnv.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture } from "../../../testing/postgrestFixture.js";
import { SIMULATOR_ACCOUNT_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { forgetAdHour, forgetAllHours, forgetHour, plantAdHour, plantHour } from "../platforms/simulator/fakeMetaInsightsHourly.js";
import type { AdRef } from "./adInsightsPull.js";
import { INSIGHTS_WINDOW_DAYS, pullConnectionInsights } from "./insightsPull.js";

/**
 * B5a — the hourly insights pull against the in-process simulator over real HTTP (the production `MetaGraph`
 * pointed at FakeMeta), with `ads_spend_hourly` held in memory between runs the way the database would
 * hold it: one row per (campaign, hour), the newest write winning. §4R's Monitor faults are the cases:
 * a late hour, an hour revised down, a missing hour, a daylight-saving day.
 */

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000a2";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const CAMP_A = "00000000-0000-4000-8000-00000000aa01";
const CAMP_B = "00000000-0000-4000-8000-00000000aa02";
const META_A = "770000000001";
const META_B = "770000000002";
const META_ARCHIVED = "770000000003";
// 09:00 on 11-03 in Chicago, so the three-day window is 11-01 (the fall-back day), 11-02 and 11-03.
const NOW = new Date("2026-11-03T15:00:00Z");

let fake: FakeMeta;
let stored: Map<string, Record<string, unknown>>;
/** `ads_ad_spend_hourly` held between runs, by (meta ad id, hour) — the table's key (CQ3). */
let storedAds: Map<string, Record<string, unknown>>;
const CREATIVE_1 = "00000000-0000-4000-8000-00000000cc01";
const CREATIVE_2 = "00000000-0000-4000-8000-00000000cc02";
const AD_1EN = "880000000011";
const AD_1ES = "880000000012";
const AD_2EN = "880000000021";
const ADS_A: AdRef[] = [
  { creative_id: CREATIVE_1, language: "en", meta_ad_id: AD_1EN },
  { creative_id: CREATIVE_1, language: "es", meta_ad_id: AD_1ES },
  { creative_id: CREATIVE_2, language: "en", meta_ad_id: AD_2EN },
];

function metaCampaign(id: string) {
  fake.campaigns.set(id, {
    id, account_id: SIMULATOR_ACCOUNT_ID, name: id, objective: "OUTCOME_LEADS", status: "ACTIVE",
    special_ad_categories: ["EMPLOYMENT"], special_ad_category_country: ["US"], spend_cap: "100000", daily_budget: null,
  });
}

/** One run: a recorder over the rows held now, then its upserts folded back in by (campaign, hour). */
async function run(opts: { days?: number; now?: Date; actions?: Array<Record<string, unknown>>; adsA?: AdRef[] } = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      ads_platform_connections: postgrestFixture([
        { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" },
        { id: CONN, org_id: OTHER_ORG, provider: "simulator", is_sandbox: true, token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, status: "connected" },
      ]),
      ads_campaigns: postgrestFixture([
        { id: CAMP_A, org_id: ORG, connection_id: CONN, state: "live", platform_refs: { meta_campaign_id: META_A, ...(opts.adsA ? { ads: opts.adsA } : {}) } },
        { id: CAMP_B, org_id: ORG, connection_id: CONN, state: "paused", platform_refs: { meta_campaign_id: META_B } },
        // Never reached Meta: nothing to read.
        { id: "00000000-0000-4000-8000-00000000aa03", org_id: ORG, connection_id: CONN, state: "creating", platform_refs: {} },
        // Done with: not read again.
        { id: "00000000-0000-4000-8000-00000000aa04", org_id: ORG, connection_id: CONN, state: "archived", platform_refs: { meta_campaign_id: META_ARCHIVED } },
        // Another carrier's campaign on a connection with the same id: never this org's.
        { id: "00000000-0000-4000-8000-00000000aa05", org_id: OTHER_ORG, connection_id: CONN, state: "live", platform_refs: { meta_campaign_id: META_A } },
      ]),
      ads_spend_hourly: postgrestFixture([...stored.values()]),
      ads_ad_spend_hourly: postgrestFixture([...storedAds.values()]),
      ads_actions: postgrestFixture(opts.actions ?? []),
    },
  });
  const r = await pullConnectionInsights({ admin: rec.client as never, env: testEnv(), processEnv: { NODE_ENV: "test" }, now: () => opts.now ?? NOW }, ORG, CONN, { days: opts.days });
  // As PostgREST applies an upsert: a row that exists is replaced, unless the call asked to skip duplicates
  // (`ignoreDuplicates` = ON CONFLICT DO NOTHING) — the one option that would keep a revised hour stale.
  for (const q of rec.writes().filter((w) => w.table === "ads_spend_hourly")) {
    const upsert = q.ops.find((o) => o.method === "upsert");
    const skip = (upsert?.args[1] as { ignoreDuplicates?: boolean } | undefined)?.ignoreDuplicates === true;
    for (const row of ([] as Array<Record<string, unknown>>).concat(q.write!.payload as never)) {
      const key = `${String(row.campaign_id)}|${String(row.hour)}`;
      if (!(skip && stored.has(key))) stored.set(key, { ...row });
    }
  }
  for (const q of rec.writes().filter((w) => w.table === "ads_ad_spend_hourly")) {
    for (const row of ([] as Array<Record<string, unknown>>).concat(q.write!.payload as never)) storedAds.set(`${String(row.meta_ad_id)}|${String(row.hour)}`, { ...row });
  }
  return { r, rec };
}

const held = (campaign: string, hour: string) => stored.get(`${campaign}|${hour}`);
const heldAd = (adId: string, hour: string) => storedAds.get(`${adId}|${hour}`);
const adReads = () => insightReads().filter((q) => q.body.level === "ad");
const insightReads = () => fake.requests.filter((q) => q.path.endsWith("/insights") && !q.path.includes("act_"));

beforeAll(async () => {
  fake = await simulatorFakeForTests();
});
afterAll(async () => stopSimulatorForTests());
beforeEach(() => {
  resetGraphThrottles();
  stored = new Map();
  storedAds = new Map();
  forgetAllHours(fake);
  for (const id of [META_A, META_B, META_ARCHIVED]) {
    fake.campaigns.delete(id);
    metaCampaign(id);
  }
  fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.timezone_name = undefined;
  fake.requests.length = 0;
});

describe("the hourly insights pull → ads_spend_hourly (B5a)", () => {
  it("writes every hour Meta reports as one UTC row in cents, with impressions, clicks and leads, for each campaign of ours on Meta", async () => {
    plantHour(fake, META_A, "2026-11-03", 8, { spend_cents: 1234, impressions: 900, clicks: 12, leads: 2 });
    plantHour(fake, META_A, "2026-11-02", 23, { spend_cents: 500, impressions: 300 });
    plantHour(fake, META_B, "2026-11-02", 10, { spend_cents: 77 });
    plantHour(fake, META_ARCHIVED, "2026-11-03", 8, { spend_cents: 9999 });
    const { r, rec } = await run();
    expect([r.zone, r.days, r.campaigns, r.hours_written, r.failures]).toEqual(["America/Chicago", ["2026-11-01", "2026-11-02", "2026-11-03"], 2, 3, []]);
    expect(held(CAMP_A, "2026-11-03T14:00:00.000Z")).toMatchObject({ org_id: ORG, spend_cents: 1234, impressions: 900, clicks: 12, leads: 2, currency: "USD", pulled_at: NOW.toISOString() });
    expect(held(CAMP_A, "2026-11-03T05:00:00.000Z")).toMatchObject({ spend_cents: 500, impressions: 300, clicks: 0, leads: 0 });
    expect(held(CAMP_B, "2026-11-02T16:00:00.000Z")).toMatchObject({ spend_cents: 77 });
    expect(stored.size).toBe(3);
    expect(insightReads().map((q) => q.path.split("/").at(-2))).toEqual([META_A, META_B]);
    expect(insightReads()[0]!.body).toMatchObject({ level: "campaign", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", time_increment: "1", time_range: JSON.stringify({ since: "2026-11-01", until: "2026-11-03" }) });
    expectOrgScoped(rec, ORG);
  });

  it("an hour Meta revises DOWN replaces the stored hour on the next run", async () => {
    plantHour(fake, META_A, "2026-11-02", 10, { spend_cents: 5000, impressions: 1000, clicks: 40, leads: 3 });
    await run();
    plantHour(fake, META_A, "2026-11-02", 10, { spend_cents: 4210, impressions: 950, clicks: 38, leads: 2 });
    await run();
    expect(held(CAMP_A, "2026-11-02T16:00:00.000Z")).toMatchObject({ spend_cents: 4210, impressions: 950, clicks: 38, leads: 2 });
  });

  it("a late hour — not reported on one run — fills in on the next, beside the hours already held", async () => {
    plantHour(fake, META_A, "2026-11-03", 6, { spend_cents: 300 });
    const first = await run();
    expect(first.r.hours_written).toBe(1);
    plantHour(fake, META_A, "2026-11-03", 7, { spend_cents: 410 });
    await run({ now: new Date(NOW.getTime() + 3_600_000) });
    expect([held(CAMP_A, "2026-11-03T12:00:00.000Z")?.spend_cents, held(CAMP_A, "2026-11-03T13:00:00.000Z")?.spend_cents]).toEqual([300, 410]);
  });

  it("an hour Meta stops reporting is written as zero — but a failed read leaves every stored hour alone", async () => {
    plantHour(fake, META_A, "2026-11-02", 10, { spend_cents: 800, clicks: 4 });
    plantHour(fake, META_B, "2026-11-02", 10, { spend_cents: 600 });
    await run();
    forgetHour(fake, META_A, "2026-11-02", 10);
    forgetHour(fake, META_B, "2026-11-02", 10);
    fake.inject("GET", new RegExp(`^${META_B}/insights$`), { kind: "token_expired" }, 1);
    const { r } = await run();
    expect([r.hours_zeroed, r.failures]).toEqual([1, [{ campaign_id: CAMP_B, reason: "graph:token_invalid" }]]);
    expect(held(CAMP_A, "2026-11-02T16:00:00.000Z")).toMatchObject({ spend_cents: 0, clicks: 0, currency: "USD" });
    expect(held(CAMP_B, "2026-11-02T16:00:00.000Z")).toMatchObject({ spend_cents: 600 });
  });

  describe("a campaign Meta says does not exist (Q-AD35)", () => {
    const recorded = (over: Record<string, unknown> = {}) => ({ id: "a1", org_id: ORG, status: "succeeded", idempotency_key: `external_change:${CONN}:campaign:${META_B}:missing:none`, ...over });
    const heldHour = "2026-11-02T16:00:00.000Z";
    const deleteB = async () => {
      plantHour(fake, META_B, "2026-11-02", 10, { spend_cents: 600 });
      await run();
      fake.campaigns.delete(META_B);
    };

    it("once reconcile has recorded it missing, it is no failure and its stored hours stay", async () => {
      await deleteB();
      const { r, rec } = await run({ actions: [recorded()] });
      expect(r.failures).toEqual([]);
      expect(held(CAMP_B, heldHour)).toMatchObject({ spend_cents: 600 });
      expectOrgScoped(rec, ORG);
    });

    it("with no record, or one for another carrier, another connection, or a row that never finished, it stays a failure", async () => {
      await deleteB();
      const failed = [{ campaign_id: CAMP_B, reason: "graph:meta_100" }];
      for (const actions of [
        [],
        [recorded({ org_id: OTHER_ORG })],
        [recorded({ idempotency_key: `external_change:other-connection:campaign:${META_B}:missing:none` })],
        [recorded({ status: "started" })],
      ]) expect((await run({ actions })).r.failures).toEqual(failed);
    });

    it("a recorded campaign refused for any other reason stays a failure", async () => {
      fake.inject("GET", new RegExp(`^${META_B}/insights$`), { kind: "token_expired" }, 1);
      const { r } = await run({ actions: [recorded()] });
      expect(r.failures).toEqual([{ campaign_id: CAMP_B, reason: "graph:token_invalid" }]);
    });

    it("if Meta still answers for a recorded campaign, its hours keep arriving", async () => {
      plantHour(fake, META_B, "2026-11-02", 10, { spend_cents: 700 });
      const { r } = await run({ actions: [recorded()] });
      expect(r.failures).toEqual([]);
      expect(held(CAMP_B, heldHour)).toMatchObject({ spend_cents: 700 });
    });
  });

  it("the fall-back day lands on the right UTC hours: the doubled 01:00 on its first, 02:00 two hours later", async () => {
    plantHour(fake, META_A, "2026-11-01", 0, { spend_cents: 100 });
    plantHour(fake, META_A, "2026-11-01", 1, { spend_cents: 260 });
    plantHour(fake, META_A, "2026-11-01", 2, { spend_cents: 140 });
    await run();
    expect([...stored.values()].map((h) => [h.hour, h.spend_cents]).sort()).toEqual([
      ["2026-11-01T05:00:00.000Z", 100], ["2026-11-01T06:00:00.000Z", 260], ["2026-11-01T08:00:00.000Z", 140],
    ]);
  });

  it("reads the hours in the zone Meta reports for the account at this run, not in Central or UTC", async () => {
    fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.timezone_name = "America/Los_Angeles";
    plantHour(fake, META_A, "2026-11-02", 14, { spend_cents: 999 });
    const { r } = await run();
    expect(r.zone).toBe("America/Los_Angeles");
    expect(held(CAMP_A, "2026-11-02T22:00:00.000Z")).toMatchObject({ spend_cents: 999 });
  });

  it("a zone it cannot convert fails the run and writes nothing, rather than guessing UTC", async () => {
    fake.accounts.get(SIMULATOR_ACCOUNT_ID)!.timezone_name = "Mars/Olympus";
    plantHour(fake, META_A, "2026-11-02", 14, { spend_cents: 999 });
    const { r, rec } = await run();
    expect([r.failures, rec.writtenRows("ads_spend_hourly")]).toEqual([[{ reason: "zone" }], []]);
  });

  it("a row it cannot read is reported, the rest of that campaign is still written, and nothing is zeroed on a partial read", async () => {
    plantHour(fake, META_A, "2026-11-02", 9, { spend_cents: 700 });
    await run();
    forgetHour(fake, META_A, "2026-11-02", 9);
    plantHour(fake, META_A, "2026-11-02", 11, { spend_cents: 50 });
    plantHour(fake, META_A, "2026-11-02", 12, { spend_cents: -1, impressions: 5 });
    const { r } = await run();
    expect(r.failures).toEqual([{ campaign_id: CAMP_A, reason: "shape" }]);
    expect([held(CAMP_A, "2026-11-02T17:00:00.000Z")?.spend_cents, held(CAMP_A, "2026-11-02T15:00:00.000Z")?.spend_cents]).toEqual([50, 700]);
  });

  it(`reads ${INSIGHTS_WINDOW_DAYS} days by default, and a widened window pages through every hour Meta holds`, async () => {
    for (let d = 1; d <= 25; d += 1) for (let h = 0; h < 24; h += 1) plantHour(fake, META_A, `2026-10-${String(d).padStart(2, "0")}`, h, { spend_cents: 1 });
    const narrow = await run();
    expect(narrow.r.hours_written).toBe(0);
    const wide = await run({ days: 28 });
    expect([wide.r.days[0], wide.r.hours_written, wide.r.failures]).toEqual(["2026-10-07", 19 * 24, []]);
    expect(insightReads().filter((q) => q.body.after).length).toBeGreaterThan(0);
  });
});

describe("the same pull at level=ad → ads_ad_spend_hourly (CQ3, D-AD22)", () => {
  it("writes one row per ad per hour, naming the creative and language the publisher recorded, beside the campaign's own row", async () => {
    plantHour(fake, META_A, "2026-11-03", 8, { spend_cents: 1234, impressions: 900, clicks: 12, leads: 2 });
    plantAdHour(fake, META_A, AD_1EN, "2026-11-03", 8, { spend_cents: 800, impressions: 600, clicks: 9, leads: 2 });
    plantAdHour(fake, META_A, AD_1ES, "2026-11-03", 8, { spend_cents: 134, impressions: 100, clicks: 1 });
    plantAdHour(fake, META_A, AD_2EN, "2026-11-03", 8, { spend_cents: 300, impressions: 200, clicks: 2 });
    const { r, rec } = await run({ adsA: ADS_A });
    expect([r.hours_written, r.ad_hours_written, r.ad_hours_zeroed, r.failures]).toEqual([1, 3, 0, []]);
    expect(heldAd(AD_1EN, "2026-11-03T14:00:00.000Z")).toMatchObject({ org_id: ORG, campaign_id: CAMP_A, creative_id: CREATIVE_1, language: "en", spend_cents: 800, leads: 2, currency: "USD", pulled_at: NOW.toISOString() });
    expect(heldAd(AD_1ES, "2026-11-03T14:00:00.000Z")).toMatchObject({ creative_id: CREATIVE_1, language: "es", spend_cents: 134 });
    expect(heldAd(AD_2EN, "2026-11-03T14:00:00.000Z")).toMatchObject({ creative_id: CREATIVE_2, language: "en", spend_cents: 300 });
    expect(held(CAMP_A, "2026-11-03T14:00:00.000Z")).toMatchObject({ spend_cents: 1234 });
    // The ad read asks the same edge and window, one level down, with the ad id in its fields.
    expect(adReads().map((q) => q.path.split("/").at(-2))).toEqual([META_A]);
    expect(adReads()[0]!.body).toMatchObject({ level: "ad", fields: expect.stringMatching(/^ad_id,/), time_range: JSON.stringify({ since: "2026-11-01", until: "2026-11-03" }) });
    expectOrgScoped(rec, ORG);
  });

  it("a campaign whose refs name no ads is not read at the ad level — nothing to name a row to", async () => {
    plantHour(fake, META_A, "2026-11-03", 8, { spend_cents: 10 });
    plantAdHour(fake, META_A, AD_1EN, "2026-11-03", 8, { spend_cents: 10 });
    const { r } = await run();
    expect([r.ad_hours_written, adReads().length, storedAds.size, r.failures]).toEqual([0, 0, 0, []]);
  });

  it("an ad our refs do not name is a failure, never a row — and its read, being partial, zeroes nothing", async () => {
    plantAdHour(fake, META_A, AD_1EN, "2026-11-02", 9, { spend_cents: 700 });
    await run({ adsA: ADS_A });
    forgetAdHour(fake, META_A, AD_1EN, "2026-11-02", 9);
    plantAdHour(fake, META_A, "889999999999", "2026-11-02", 10, { spend_cents: 55 });
    plantAdHour(fake, META_A, AD_2EN, "2026-11-02", 11, { spend_cents: 40 });
    const { r } = await run({ adsA: ADS_A });
    expect(r.failures).toEqual([{ campaign_id: CAMP_A, reason: "ads:unknown_ad:889999999999" }]);
    expect(heldAd("889999999999", "2026-11-02T16:00:00.000Z")).toBeUndefined();
    expect([heldAd(AD_2EN, "2026-11-02T17:00:00.000Z")?.spend_cents, heldAd(AD_1EN, "2026-11-02T15:00:00.000Z")?.spend_cents]).toEqual([40, 700]);
  });

  it("an ad hour Meta stops reporting is zeroed on the next complete read, while another ad's hour stands", async () => {
    plantAdHour(fake, META_A, AD_1EN, "2026-11-02", 9, { spend_cents: 700, leads: 1 });
    plantAdHour(fake, META_A, AD_2EN, "2026-11-02", 9, { spend_cents: 300 });
    await run({ adsA: ADS_A });
    forgetAdHour(fake, META_A, AD_1EN, "2026-11-02", 9);
    const { r } = await run({ adsA: ADS_A });
    expect([r.ad_hours_written, r.ad_hours_zeroed]).toEqual([1, 1]);
    expect(heldAd(AD_1EN, "2026-11-02T15:00:00.000Z")).toMatchObject({ spend_cents: 0, leads: 0, creative_id: CREATIVE_1, language: "en" });
    expect(heldAd(AD_2EN, "2026-11-02T15:00:00.000Z")).toMatchObject({ spend_cents: 300 });
  });

  it("an ad hour revised down is replaced, never kept stale, and the upsert names every column", async () => {
    plantAdHour(fake, META_A, AD_1EN, "2026-11-02", 10, { spend_cents: 5000, impressions: 1000, clicks: 40, leads: 3 });
    await run({ adsA: ADS_A });
    plantAdHour(fake, META_A, AD_1EN, "2026-11-02", 10, { spend_cents: 4210, impressions: 950, clicks: 38, leads: 2 });
    const { rec } = await run({ adsA: ADS_A });
    expect(heldAd(AD_1EN, "2026-11-02T16:00:00.000Z")).toMatchObject({ spend_cents: 4210, impressions: 950, clicks: 38, leads: 2 });
    const up = rec.writes().find((w) => w.table === "ads_ad_spend_hourly")!.ops.find((o) => o.method === "upsert")!;
    expect(up.args[1]).toEqual({ onConflict: "meta_ad_id,hour" });
    expect(Object.keys(([] as Array<Record<string, unknown>>).concat(up.args[0] as never)[0]!).sort()).toEqual(["campaign_id", "clicks", "creative_id", "currency", "hour", "impressions", "language", "leads", "meta_ad_id", "org_id", "pulled_at", "spend_cents"]);
  });
});
