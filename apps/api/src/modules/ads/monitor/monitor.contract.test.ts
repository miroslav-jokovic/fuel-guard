import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { openMetaTarget, type MetaTarget } from "../platforms/meta/contract/metaTarget.js";
import { compareRecorded, fromWire, kindOf } from "../platforms/meta/contract/readings.js";
import { contractEnv, targetConnection } from "../platforms/meta/contract/targetConnection.js";
import { MetaGraph, resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { publishPaused } from "../platforms/meta/publisher.js";
import { reviewAds } from "./adReview.js";
import { pullConnectionInsights } from "./insightsPull.js";

/**
 * The MONITOR's L4 suite (stage2-kit-2c; §4R "insights from the sandbox"), the Publisher's pattern: one file, the
 * target `ADS_TARGET` names, a fault proxy in front, nothing below reads the fake's maps.
 *
 * A campaign is published PAUSED on the target. Then the monitor's own production code reads it: the hourly pull
 * (`insightsPull.ts`) opens the connection's SEALED token through the registry, as on a server, pointed at the
 * proxy; the review read (`adReview.ts`) reads each ad's verdict. Two paths no sandbox gives on request are played
 * on the wire: a dead token (the proxy answers Graph's 190) and an ad Meta turned down (the proxy sets the verdict
 * fields on the target's real answer). What the target itself answered is recorded as readings and diffed by field
 * against `readings.recorded.json`, so a FakeMeta shape the sandbox does not share is named.
 */

const env = contractEnv();
let t: MetaTarget;
let w: AdsWorld;
let id: string;
let refs: { meta_campaign_id: string; meta_adset_id: string; meta_ad_ids: string[] };

beforeEach(async () => {
  resetGraphThrottles();
  t = await openMetaTarget();
  id = randomUUID();
  const png = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 40, g: 70, b: 120 } } }).png().toBuffer();
  const sha = createHash("sha256").update(png).digest("hex");
  const graph = (token: string) => new MetaGraph({ token, throttleKey: `monitor-setup:${id}`, baseUrl: t.base, timeoutMs: t.timeoutMs, sleep: async () => {} });
  const setup = createAdsWorld({ campaigns: [campaign(id, "creating")], settings: LIVE_SETTINGS, connections: [{ ...targetConnection(t, env, { org: ORG, connection: CONN }) }] });
  const published = await publishPaused({ admin: setup.admin, graph: graph(t.token()), pageGraph: graph(t.pageToken()), readAsset: async () => png, now: setup.now }, {
    orgId: ORG, campaignId: id, connectionId: CONN, accountId: t.accountId, pageId: t.pageId, platform: "meta",
    brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-09T15:00:00Z",
    area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
    daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${id}:monitor`, claims: [{ kind: "money", cents: 62, per: "mile" }, { kind: "quantity", value: 23, unit: "age" }, { kind: "quantity", value: 2, unit: "year" }], form_questions: ["class_a_held"], privacy_url: "https://app.silvicom360.com/privacy",
    creatives: [{ id: `${id}-cr`, preset_key: "P2", platform_slots: { primary_text: "body", headline: "title" },
      copy: { en: { hook: "Home weekly", cta: "Apply now", body: "Regional lanes.", title: "Class A drivers" }, es: { hook: "En casa", cta: "Aplica ya", body: "Rutas regionales.", title: "Choferes Clase A" } },
      assets: [{ format: "4:5", language: "en", sha256: sha }, { format: "4:5", language: "es", sha256: sha }] }],
  });
  if (!published.ok) throw new Error(`setup: publish failed ${published.error_code}`);
  refs = published.platform_refs as typeof refs;
  t.proxy.calls.length = 0;
  w = createAdsWorld({ campaigns: [campaign(id, "live", { connection_id: CONN, platform_refs: refs })], settings: LIVE_SETTINGS, connections: [targetConnection(t, env, { org: ORG, connection: CONN })] });
});
afterEach(() => t.close());

const deps = () => ({ admin: w.admin, env, processEnv: { NODE_ENV: "test" }, now: w.now, metaGraphBase: t.base });
const reviewGraph = () => new MetaGraph({ token: t.token(), throttleKey: `monitor-review:${id}`, baseUrl: t.base, timeoutMs: t.timeoutMs, sleep: async () => {} });

describe("the monitor on the target (§4R Monitor L4)", () => {
  it("the hourly pull reads the target through the sealed connection: the account's zone, every hour it reports, no failure", async () => {
    const r = await pullConnectionInsights(deps(), ORG, CONN);
    expect(r.failures).toEqual([]);
    expect(r.zone).not.toBeNull();
    expect(r.campaigns).toBe(1);
    const insights = t.proxy.calls.filter((c) => c.method === "GET" && c.path === `${refs.meta_campaign_id}/insights`);
    expect(insights.length).toBeGreaterThan(0);
    const reported = insights.reduce((n, c) => n + ((c.upstream?.body as { data?: unknown[] })?.data?.length ?? 0), 0);
    expect(r.hours_written).toBe(reported);
    expectOrgScoped(w.rec, ORG);
  });

  it("an ad the platform turned down is recorded once and rings ads_rejected once, with Meta's reason", async () => {
    const [ad] = refs.meta_ad_ids;
    t.proxy.overlay(new RegExp(`^${ad}$`), { effective_status: "DISAPPROVED", ad_review_feedback: { global: { LANDING_PAGE_FAIL: "The landing page does not work." } } });
    const target = [{ campaign_id: id, state: "live", ad_ids: refs.meta_ad_ids }];
    const first = await reviewAds({ admin: w.admin, now: w.now }, reviewGraph(), ORG, CONN, target);
    expect(first).toMatchObject({ read: 2, recorded: [{ ad_id: ad, status: "DISAPPROVED" }], failures: [] });
    const again = await reviewAds({ admin: w.admin, now: w.now }, reviewGraph(), ORG, CONN, target);
    expect(again).toMatchObject({ recorded: [], already_recorded: 1, failures: [] });
    expect(w.bell.filter((b) => b.category === "ads_rejected").map((b) => b.severity)).toEqual(["critical"]);
    expect(w.actions.filter((a) => a.kind === "external_change").map((a) => (a.request as { reasons: string[] }).reasons)).toEqual([["The landing page does not work."]]);
  });

  it("a dead token stops the pull as token_invalid, writes no hour, and tells an admin once", async () => {
    t.proxy.faults.inject("GET", /^act_\d+$/, { kind: "token_expired" });
    const r = await pullConnectionInsights(deps(), ORG, CONN);
    expect(r.failures).toEqual([{ reason: "account:token_invalid" }]);
    expect(r.hours_written).toBe(0);
    expect(w.bell.map((b) => [b.category, b.severity])).toEqual([["ads_token_expiring", "critical"]]);
  });

  it("the target's answers to the monitor's reads are what FakeMeta committed to (OUR readings, diffed by field)", async () => {
    await pullConnectionInsights(deps(), ORG, CONN);
    await reviewAds({ admin: w.admin, now: w.now }, reviewGraph(), ORG, CONN, [{ campaign_id: id, state: "live", ad_ids: refs.meta_ad_ids }]);
    const calls = t.proxy.calls;
    const differences = compareRecorded("monitor", {
      "monitor-account": fromWire(calls, /^act_\d+$/, "platforms/simulator/fakeMeta.ts", (b) => ({ timezone_name: kindOf(b.timezone_name), currency: kindOf(b.currency) })),
      "monitor-insights": fromWire(calls, /^\d+\/insights$/, "platforms/simulator/fakeMetaInsightsHourly.ts", (b) => ({ data: kindOf(b.data), paging: kindOf(b.paging) })),
      "monitor-ad-review": fromWire(calls, /^\d+$/, "platforms/simulator/fakeMetaFaults.ts", (b) => ({ effective_status: kindOf(b.effective_status), "ad_review_feedback on a fresh ad": "ad_review_feedback" in b })),
    }, t.name);
    expect(differences).toEqual([]);
  });
});
