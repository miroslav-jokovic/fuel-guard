import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADS_CREATIVE_REFRESH_DEFAULT, parseAdName, type AdBrief, type AdPresetRecipe } from "@silvicom/shared";
import { loadEnv } from "../../../env.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, T0, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, SIMULATOR_PAGE_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { retireTiredAds } from "../monitor/retireTired.js";
import { runCampaignStep } from "./runner.js";
import { adsWorkers } from "./workers.js";
import { publishReplacement } from "../platforms/meta/publishCampaign.js";
import { readAdAsset } from "../creative/brandAssets.js";

/**
 * `createPaused` over the REAL path (B2c2): the runner → `adsWorkers` → `publishCampaign` (our rows) →
 * `publishPaused` → `MetaGraph` → the in-process simulator, and then launch over the ads it made. Nothing
 * below the runner is scripted; what exists on the platform is read from the fake the publisher talked to.
 * §4R Publisher L2 "token revoked → stops + alert" is here, on the runner, where the alert is sent.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const env = loadEnv({ NODE_ENV: "test", WEB_APP_URL: "https://app.silvicom360.test" } as NodeJS.ProcessEnv);
const SETTINGS = { ...LIVE_SETTINGS, limits: { ...LIVE_SETTINGS.limits, monthly_cap_cents: { meta: 300_000, simulator: 300_000 } } };
const CAMPAIGN = "c2c20000-0000-4000-8000-000000000001";
const CREATIVE = "c7ea0000-0000-4000-8000-000000000001";
const VERSION = "7e750000-0000-4000-8000-000000000001";
const PRESET = "9e5e0000-0000-4000-8000-000000000001";

const connection = { id: CONN, org_id: ORG, provider: "simulator", is_sandbox: false, token_sealed: null, page_token_sealed: null, account_ref: SIMULATOR_ACCOUNT_ID, page_ref: SIMULATOR_PAGE_ID, status: "connected" };
const brief: AdBrief = {
  source: "recruiting_opening", ref: "op-7@v2", subject: "Class A regional driver", claims: [{ kind: "money", cents: 150_000, per: "week" }],
  area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
  subject_matter: { details: [], in_our_words: null },
  form_questions: ["class_a_held"], landing_url: null,
};
const recipe: AdPresetRecipe = {
  name: "Fixture", hook_formula: "Lead with the figure.",
  copy_slots: [{ name: "hook", max_chars: 60 }, { name: "cta", max_chars: 30 }, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }],
  image_prompt_template: "A {vehicle} at dusk, no text, no logos, no lettering", image_slots: ["vehicle"],
  starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, layout: "bottom_plate", formats: ["4:5"],
  overlay_slots: { headline: "hook", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" },
};

/** Stored images keyed as `brandAssets.assetKey` keys them; `readAdAsset` checks each one's sha256. */
function png(tag: string): Buffer {
  const head = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(1080, 16);
  head.writeUInt32BE(1350, 20);
  return Buffer.concat([head, Buffer.from(tag)]);
}
const images = [png("en"), png("es")];
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const stored = new Map(images.map((b) => [`${ORG}/${sha(b)}.png`, b]));

function world(patch: { state?: "creating" | "launching"; creativeState?: string; conn?: Record<string, unknown>; refs?: Record<string, unknown> } = {}): AdsWorld {
  const creative = { id: CREATIVE, org_id: ORG, campaign_id: CAMPAIGN, preset_version_id: VERSION, state: patch.creativeState ?? "approved", created_at: T0,
    copy: { en: { hook: "Home weekly", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
            es: { hook: "En casa", cta: "Aplica", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
    assets: [{ format: "4:5", language: "en", sha256: sha(images[0]!) }, { format: "4:5", language: "es", sha256: sha(images[1]!) }] };
  return createAdsWorld({
    campaigns: [campaign(CAMPAIGN, patch.state ?? "creating", { brief_source: brief.source, brief_ref: brief.ref, brief_snapshot: brief, created_at: "2026-11-04T15:00:00Z", platform_refs: patch.refs ?? {} })],
    settings: SETTINGS, connections: [{ ...connection, ...patch.conn }],
    approvals: [{ id: "appr-1", org_id: ORG, campaign_id: CAMPAIGN, kind: "launch", withdraws_id: null, approved_by: OWNER, approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: T0 }],
    extraTables: {
      ads_creatives: [creative],
      ad_concept_preset_versions: [{ id: VERSION, org_id: ORG, preset_id: PRESET, recipe }],
      ad_concept_presets: [{ id: PRESET, org_id: ORG, key: "P3" }],
      ads_ad_spend_hourly: [],
    },
    storage: { download: (key: string) => (stored.has(key) ? { data: new Blob([new Uint8Array(stored.get(key)!)]), error: null } : { data: null, error: { message: "Object not found" } }) },
  });
}
const step = (w: AdsWorld) => runCampaignStep({ admin: w.admin, now: w.now, workers: adsWorkers({ admin: w.admin, env, now: w.now }) }, ORG, CAMPAIGN);

let fake: FakeMeta;
beforeEach(async () => {
  resetGraphThrottles();
  fake = await simulatorFakeForTests();
});
afterEach(() => stopSimulatorForTests());

describe("createPaused × the real Meta path on the simulator (B2c2)", () => {
  it("creating publishes the approved creative as two paused ads and moves the campaign to paused holding every id launch needs", async () => {
    const w = world();
    expect(await step(w)).toMatchObject({ kind: "stepped", event: "created", result: { kind: "moved", to: "paused" } });
    const refs = w.byId(CAMPAIGN).platform_refs as { meta_campaign_id: string; meta_ad_ids: string[]; meta_form_ids: Record<string, string> };
    expect(refs.meta_ad_ids).toHaveLength(2);
    expect(Object.keys(refs.meta_form_ids).sort()).toEqual(["en", "es"]);
    expect(refs.meta_ad_ids.map((id) => fake.sets.ads.get(id)!.status)).toEqual(["PAUSED", "PAUSED"]);
    expect(refs.meta_ad_ids.map((id) => parseAdName(fake.sets.ads.get(id)!.name))).toMatchObject([{ platform: "simulator", preset_key: "P3", language: "en" }, { language: "es" }]);
    expect(fake.campaigns.get(refs.meta_campaign_id)!.status).toBe("PAUSED");
    expect(fake.forms.forms.get(refs.meta_form_ids.es!)!.privacy_policy_url).toBe("https://app.silvicom360.test/privacy");
    expectOrgScoped(w.rec, ORG);
  });

  it("then an approved launch turns on exactly the ads it made, and the campaign last", async () => {
    const w = world();
    await step(w);
    const refs = w.byId(CAMPAIGN).platform_refs as { meta_campaign_id: string; meta_ad_ids: string[] };
    w.byId(CAMPAIGN).state = "launching";
    expect(await step(w)).toMatchObject({ kind: "stepped", event: "launched", result: { kind: "moved", to: "live" } });
    expect([fake.campaigns.get(refs.meta_campaign_id)!.status, ...refs.meta_ad_ids.map((id) => fake.sets.ads.get(id)!.status)]).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
  });

  it("a pause and a relaunch keep the retired ad off: the monitor retires the tired EN ad, and the new launch turns on only its ES sibling", async () => {
    // The 2026-11-11 finding (CQ9 in ADS-CREATIVE-QUALITY-PLAN): launch turned on every ad in `meta_ad_ids`, so the
    // ad CQ9b retired came back on. One creative, two language ads: the retired one is an AD, not the creative.
    const w = world();
    await step(w);
    const refs = w.byId(CAMPAIGN).platform_refs as { meta_campaign_id: string; meta_ad_ids: string[] };
    const [en, es] = refs.meta_ad_ids as [string, string];
    w.byId(CAMPAIGN).state = "launching";
    expect(await step(w)).toMatchObject({ event: "launched", result: { to: "live" } });

    // Twenty days of hours: EN's click-through halves after its first week, ES holds — the monitor's own judgement.
    const born = Date.parse(T0) - 20 * 86_400_000;
    const day = (ad: string, d: number, ctr: number) => ({ org_id: ORG, campaign_id: CAMPAIGN, meta_ad_id: ad, hour: new Date(born + d * 86_400_000).toISOString(), impressions: 1000, clicks: Math.round(1000 * ctr) });
    w.extra.ads_ad_spend_hourly!.push(...Array.from({ length: 20 }, (_, d) => [day(en, d, d < 7 ? 0.02 : 0.01), day(es, d, 0.02)]).flat());
    const retired = await retireTiredAds({ admin: w.admin, env, processEnv: { NODE_ENV: "test" }, now: w.now }, ORG, CONN, { ...ADS_CREATIVE_REFRESH_DEFAULT, retire: true });
    expect(retired.verdicts.map((v) => [v.meta_ad_id, v.acted])).toEqual([[en, "retired"], [es, "not_tired"]]);

    w.byId(CAMPAIGN).state = "pausing";
    expect(await step(w)).toMatchObject({ event: "paused", result: { to: "paused" } });
    w.approvals.push({ id: "appr-2", org_id: ORG, campaign_id: CAMPAIGN, kind: "launch", withdraws_id: null, approved_by: OWNER, approved_by_name: "Owner", daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, created_at: w.now().toISOString() });
    w.byId(CAMPAIGN).state = "launching";
    const posts = fake.requests.length;
    expect(await step(w)).toMatchObject({ event: "launched", result: { to: "live" } });
    expect([fake.campaigns.get(refs.meta_campaign_id)!.status, fake.sets.ads.get(en)!.status, fake.sets.ads.get(es)!.status]).toEqual(["ACTIVE", "PAUSED", "ACTIVE"]);
    expect(fake.requests.slice(posts).filter((q) => q.method === "POST" && q.path.endsWith(en))).toEqual([]);
    expectOrgScoped(w.rec, ORG);
  });

  it("a creative still waiting for a person is never published: no approved creative fails the step before Meta is asked anything", async () => {
    // `ready` = passed its checks, not yet approved (D-AD12: a person approves every creative).
    const w = world({ creativeState: "ready" });
    const before = fake.requests.length;
    expect(await step(w)).toMatchObject({ kind: "stepped", event: "create_failed", result: { kind: "moved", to: "failed" } });
    expect(w.byId(CAMPAIGN).last_error).toBe("no_approved_creative");
    expect(fake.requests.length).toBe(before);
    expect(w.bell).toHaveLength(0);
  });

  it("a revoked token stops the create as token_invalid, marks the connection failing and tells an admin once", async () => {
    fake.revokeToken();
    const w = world();
    expect(await step(w)).toMatchObject({ kind: "stepped", event: "create_failed" });
    expect(w.byId(CAMPAIGN).last_error).toBe("token_invalid");
    expect(w.connections[0]).toMatchObject({ status: "failing", last_error: "create: token_invalid" });
    expect(w.bell.map((b) => [b.category, b.severity])).toEqual([["ads_token_expiring", "critical"]]);
    expect(fake.requests.filter((q) => q.method === "POST")).toHaveLength(0);
  });

  it("a disconnected connection fails the create as no_platform, with the same alert, and nothing is sent", async () => {
    const w = world({ conn: { status: "disconnected" } });
    const before = fake.requests.length;
    expect(await step(w)).toMatchObject({ kind: "stepped", event: "create_failed" });
    expect(w.byId(CAMPAIGN).last_error).toBe("no_platform");
    expect(w.bell.map((b) => b.category)).toEqual(["ads_token_expiring"]);
    expect(fake.requests.length).toBe(before);
  });
});

describe("publishReplacement × the real Meta path on the simulator (Q-AD68)", () => {
  // Distinct in its first eight hex characters, as a derived id is (`stintCreativeId` hashes); the name carries those.
  const REPLACEMENT = "d1ea0000-0000-4000-8000-0000000000f2";
  const ALIKE = "c7ea0000-0000-4000-8000-0000000000f3";

  /** The created campaign, now live, holding the retired creative and its approved replacement (same preset, made fresh). */
  function liveWorld(refs: Record<string, unknown>, replacement: Record<string, unknown> = {}, id = REPLACEMENT): AdsWorld {
    const base = { org_id: ORG, campaign_id: CAMPAIGN, preset_version_id: VERSION, created_at: T0,
      copy: { en: { hook: "Home weekly", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
              es: { hook: "En casa", cta: "Aplica", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
      assets: [{ format: "4:5", language: "en", sha256: sha(images[0]!) }, { format: "4:5", language: "es", sha256: sha(images[1]!) }] };
    return createAdsWorld({
      campaigns: [campaign(CAMPAIGN, "live", { brief_source: brief.source, brief_ref: brief.ref, brief_snapshot: brief, created_at: "2026-11-04T15:00:00Z", platform_refs: refs })],
      settings: SETTINGS, connections: [connection],
      extraTables: {
        ads_creatives: [{ ...base, id: CREATIVE, state: "approved", platform_status: "retired" }, { ...base, id, state: "approved", supersedes_id: CREATIVE, created_at: "2026-11-11T12:00:00Z", ...replacement }],
        ad_concept_preset_versions: [{ id: VERSION, org_id: ORG, preset_id: PRESET, recipe }],
        ad_concept_presets: [{ id: PRESET, org_id: ORG, key: "P3" }],
      },
      storage: { download: (key: string) => (stored.has(key) ? { data: new Blob([new Uint8Array(stored.get(key)!)]), error: null } : { data: null, error: { message: "Object not found" } }) },
    });
  }
  const deps = (w: AdsWorld) => ({ admin: w.admin, env, now: w.now, readAsset: (orgId: string, ref: { sha256: string; format: string }) => readAdAsset(w.admin, orgId, ref as never) });

  it("makes the replacement's two ads PAUSED in the campaign's existing ad set, new ads (never the retired ones adopted), and nothing above the ad", async () => {
    const created = world();
    await step(created);
    const refs = created.byId(CAMPAIGN).platform_refs as { meta_adset_id: string; meta_ad_ids: string[]; meta_campaign_id: string };
    const counts = () => [fake.campaigns.size, fake.sets.adsets.size];
    const before = counts();
    const w = liveWorld(refs);
    const out = await publishReplacement(deps(w), { ...w.byId(CAMPAIGN), platform_refs: refs } as never, REPLACEMENT);
    expect(out).toMatchObject({ ok: true });
    const ads = (out as { ads: Array<{ meta_ad_id: string; language: string; creative_id: string }> }).ads;
    expect(ads.map((a) => [a.language, a.creative_id])).toEqual([["en", REPLACEMENT], ["es", REPLACEMENT]]);
    expect(ads.every((a) => !refs.meta_ad_ids.includes(a.meta_ad_id))).toBe(true);
    expect(ads.map((a) => [fake.sets.ads.get(a.meta_ad_id)!.status, fake.sets.ads.get(a.meta_ad_id)!.adset_id])).toEqual([["PAUSED", refs.meta_adset_id], ["PAUSED", refs.meta_adset_id]]);
    expect(counts()).toEqual(before);
    expectOrgScoped(w.rec, ORG);
    // Asked again (a retried step), it adopts the ads it made and creates none.
    const again = await publishReplacement(deps(w), { ...w.byId(CAMPAIGN), platform_refs: refs } as never, REPLACEMENT);
    expect((again as { ads: Array<{ meta_ad_id: string }> }).ads.map((a) => a.meta_ad_id)).toEqual(ads.map((a) => a.meta_ad_id));
  });

  it("refuses an ad the campaign already holds: a replacement whose short id is the retired creative's would adopt the retired ads", async () => {
    const created = world();
    await step(created);
    const refs = created.byId(CAMPAIGN).platform_refs as { meta_ad_ids: string[] };
    const w = liveWorld(refs, {}, ALIKE);
    const out = await publishReplacement(deps(w), { ...w.byId(CAMPAIGN), platform_refs: refs } as never, ALIKE);
    expect(out).toMatchObject({ ok: false, error_code: "adopted_existing_ad" });
    expect(refs.meta_ad_ids.map((id) => fake.sets.ads.get(id)!.status)).toEqual(["PAUSED", "PAUSED"]);
  });

  it("refuses before any call: a creative not approved, or a campaign whose refs hold no ad set or forms", async () => {
    const before = fake.requests.length;
    expect(await publishReplacement(deps(liveWorld({})), liveWorld({}).byId(CAMPAIGN) as never, REPLACEMENT)).toEqual({ ok: false, error_code: "not_on_platform" });
    const notYet = liveWorld({ meta_adset_id: "1", meta_form_ids: { en: "2", es: "3" } }, { state: "ready" });
    expect(await publishReplacement(deps(notYet), notYet.byId(CAMPAIGN) as never, REPLACEMENT)).toEqual({ ok: false, error_code: "creative_not_approved" });
    expect(fake.requests.length).toBe(before);
  });
});
