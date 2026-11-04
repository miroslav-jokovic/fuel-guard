import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAdName, type AdBrief, type AdPresetRecipe } from "@silvicom/shared";
import { loadEnv } from "../../../env.js";
import { campaign, CONN, createAdsWorld, LIVE_SETTINGS, ORG, T0, type AdsWorld } from "../../../testing/adsWorld.js";
import { expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { resetGraphThrottles } from "../platforms/meta/graphClient.js";
import { SIMULATOR_ACCOUNT_ID, SIMULATOR_PAGE_ID, simulatorFakeForTests, stopSimulatorForTests } from "../platforms/registry.js";
import type { FakeMeta } from "../platforms/simulator/fakeMeta.js";
import { runCampaignStep } from "./runner.js";
import { adsWorkers } from "./workers.js";

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
  form_questions: ["class_a_held"], landing_url: null,
};
const recipe: AdPresetRecipe = {
  name: "Fixture", hook_formula: "Lead with the figure.",
  copy_slots: [{ name: "hook", max_chars: 60 }, { name: "cta", max_chars: 30 }, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }],
  image_prompt_template: "A {vehicle} at dusk, no text, no logos, no lettering", image_slots: ["vehicle"],
  starts_from: "equipment_photo", shows_equipment: true, shows_people: false, motion_template: null, formats: ["4:5"],
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
