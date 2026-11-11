import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, REFRESH_ATTEMPTS, type CreativeState } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import type { PlatformAdapter } from "../platforms/adapter.js";
import type { CampaignRow } from "../orchestrator/transitions.js";
import type { ComposeInput, ComposeOutcome } from "./composeCreative.js";
import { stintCreativeId } from "./composeCampaign.js";
import { refreshCampaign, type RefreshDeps } from "./refreshCampaign.js";

/**
 * A retired ad's replacement on a live campaign (Q-AD68). The step's decisions against a small stateful world —
 * creatives, the ledger, the campaign's refs, approvals, the bell — with its three effects faked: making a creative
 * (`composeCreative`'s own suite proves one), publishing one (`publishReplacement`), and the adapter's `activateAd`.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = "0a1b2c3d-0000-4000-8000-0000000000d1";
const T0 = "2026-11-11T12:00:00.000Z";
const copyFx = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const recipe = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, overlay_slots: { headline: "hook", cta: "cta" } };
const REFS = { meta_campaign_id: "771", meta_adset_id: "881", meta_form_ids: { en: "f-en", es: "f-es" }, meta_ad_ids: ["9001", "9002"], ads: [{ creative_id: "cr-old", language: "en", meta_ad_id: "9001" }, { creative_id: "cr-two", language: "en", meta_ad_id: "9002" }] };
const live = (): CampaignRow => ({ id: "c-1", org_id: ORG, connection_id: "conn", state: "live", state_changed_at: T0, daily_budget_cents: 5000, lifetime_cap_cents: 50000, platform_refs: REFS });

type Creative = { id: string; org_id: string; campaign_id: string; preset_version_id: string; state: CreativeState; regenerations: number; platform_status: string | null; supersedes_id: string | null; created_at: string; updated_at?: string };
const cr = (id: string, version: string, over: Partial<Creative> = {}): Creative => ({ id, org_id: ORG, campaign_id: "c-1", preset_version_id: version, state: "approved", regenerations: 0, platform_status: null, supersedes_id: null, created_at: T0, ...over });

function world(opts: { keys?: string[]; enabled?: Record<string, boolean>; creatives?: Creative[]; approvals?: FixtureRow[]; campaignState?: string } = {}) {
  const keys = opts.keys ?? ["P1", "P2"];
  const presets = keys.map((k) => ({ id: `p-${k}`, key: k, archived_at: null }));
  const versions = keys.map((k) => ({ id: `pv-${k}`, preset_id: `p-${k}`, version: 1, recipe, enabled: opts.enabled?.[k] ?? true, created_at: T0, created_by_name: "Owner" }));
  const creatives: Creative[] = (opts.creatives ?? [cr("cr-old", "pv-P1", { platform_status: "retired" }), cr("cr-two", "pv-P2")]).map((c) => ({ ...c }));
  const actions: FixtureRow[] = [];
  const approvals: FixtureRow[] = (opts.approvals ?? []).map((a) => ({ ...a }));
  const campaigns: FixtureRow[] = [{ id: "c-1", org_id: ORG, brief_ref: "opening@v1", brief_snapshot: copyFx.input.brief, brand_kit_id: "k-1", state: opts.campaignState ?? "live", platform_refs: REFS }];
  const bell: Array<{ category: string; title: string; dedupe: string | null }> = [];
  let seq = 0;
  const hit = <R extends FixtureRow>(rows: R[], q: RecordedQuery) => rows.filter((r) => postgrestFixture([{ ...r }])({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "limit") }).length > 0);

  const rec = createSupabaseRecorder({
    tables: {
      ads_creatives: (q) => {
        if (q.write?.method === "insert") {
          const row = q.write.payload as Creative;
          if (creatives.some((c) => c.id === row.id)) return { data: null, error: { code: "23505", message: "dup" }, writeError: { code: "23505", message: "dup" } };
          const stored = { ...row, regenerations: 0, platform_status: null, created_at: `2026-11-11T12:00:0${++seq}.000Z` };
          creatives.push(stored);
          return [stored];
        }
        if (q.write?.method === "update") { for (const c of hit(creatives, q)) Object.assign(c, q.write.payload as object); return []; }
        return postgrestFixture(creatives)(q);
      },
      ads_actions: (q) => {
        if (q.write?.method === "insert") {
          const row = q.write.payload as FixtureRow;
          if (actions.some((a) => a.idempotency_key === row.idempotency_key)) return { data: null, error: { code: "23505", message: "dup" }, writeError: { code: "23505", message: "dup" } };
          const stored = { id: `act-${actions.length + 1}`, ...row };
          actions.push(stored);
          return [{ id: stored.id }];
        }
        if (q.write?.method === "update") { for (const a of hit(actions, q)) Object.assign(a, q.write.payload as object); return []; }
        return postgrestFixture(actions)(q);
      },
      ads_campaigns: (q) => {
        if (q.write?.method === "update") { const h = hit(campaigns, q); for (const c of h) Object.assign(c, q.write.payload as object); return h.map((c) => ({ platform_refs: c.platform_refs })); }
        return postgrestFixture(campaigns)(q);
      },
      ads_approvals: postgrestFixture(approvals),
      ad_concept_presets: presets,
      ad_concept_preset_versions: versions,
      ad_brand_kits: [{ id: "k-1", name: "Kit", archived_at: null }],
      ad_brand_kit_versions: [{ id: "kv-1", kit_id: "k-1", version: 1, kit: { ...artFx.input.kit, overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } } }, created_at: T0, created_by_name: "Owner" }],
      ads_settings_versions: [{ id: "v1", version: 1, settings: { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, max_regenerations: 1 } }, kill_switch: false }],
      memberships: [{ org_id: ORG, user_id: ADMIN, role: "admin", suspended_at: null }],
    },
    rpc: (fn, args) => {
      if (fn !== "emit_notification") return null;
      const a = args as { p_category: string; p_title: string; p_dedupe_key: string | null };
      if (a.p_dedupe_key && bell.some((b) => b.dedupe === a.p_dedupe_key)) return null;
      bell.push({ category: a.p_category, title: a.p_title, dedupe: a.p_dedupe_key });
      return `ntf-${bell.length}`;
    },
  });

  const composed: string[] = [];
  const outcomes = new Map<string, ComposeOutcome>();
  const activateAd = vi.fn(async () => ({ ok: true as const }));
  const publishOne = vi.fn(async (_c: CampaignRow, creativeId: string) => ({ ok: true as const, ads: (["en", "es"] as const).map((language, i) => ({ creative_id: creativeId, language, image_hash: `h${i}`, meta_creative_id: `mc${i}`, meta_ad_id: `95${i}` })) }));
  const deps: RefreshDeps = {
    admin: rec.client, now: () => new Date(T0),
    composeOne: vi.fn(async (input: ComposeInput) => {
      composed.push(input.creative.id);
      const out = outcomes.get(input.creative.id) ?? { kind: "pending", why: "render queued" };
      if (out.kind === "ready") Object.assign(creatives.find((c) => c.id === input.creative.id)!, { state: "ready" });
      if (out.kind === "check_failed") Object.assign(creatives.find((c) => c.id === input.creative.id)!, { state: "check_failed" });
      return out;
    }),
    publishOne,
    platform: async () => ({ platform: "meta", adapter: { safe: { activateAd } } as unknown as PlatformAdapter }),
  };
  return { rec, deps, creatives, actions, approvals, campaigns, bell, composed, outcomes, activateAd, publishOne, run: () => refreshCampaign(deps, live()) };
}
const replacementOf = (w: ReturnType<typeof world>) => w.creatives.filter((c) => c.supersedes_id === "cr-old");
const APPROVAL = { id: "ap-1", org_id: ORG, campaign_id: "c-1", creative_id: "cr-new", kind: "approve_creative", withdraws_id: null, created_at: T0 };

describe("refreshCampaign — what enters for a retired ad (Q-AD68)", () => {
  it("nothing retired: nothing is read beyond the creatives, nothing made", async () => {
    const w = world({ creatives: [cr("cr-old", "pv-P1"), cr("cr-two", "pv-P2")] });
    expect(await w.run()).toEqual({ ok: true });
    expect([w.composed, w.creatives.length]).toEqual([[], 2]);
    expect(w.rec.queries.map((q) => q.table)).toEqual(["ads_creatives"]);
  });

  it("every preset already run: the retired ad's own preset is made again, naming the retired ad, with a derived id; a re-run moves the same row", async () => {
    const w = world();
    expect(await w.run()).toEqual({ ok: false, pending: true, why: expect.stringContaining("render queued") });
    const [rep] = replacementOf(w);
    expect(rep).toMatchObject({ preset_version_id: "pv-P1", supersedes_id: "cr-old", state: "generating", id: stintCreativeId("c-1", "pv-P1", "refresh:cr-old:0") });
    await w.run();
    expect([replacementOf(w).length, w.composed]).toEqual([1, [rep!.id, rep!.id]]);
    expectOrgScoped(w.rec, ORG);
  });

  it("an enabled preset the campaign never ran enters before a fresh execution of the retired one", async () => {
    const w = world({ keys: ["P1", "P2", "P3"] });
    await w.run();
    expect(replacementOf(w).map((c) => c.preset_version_id)).toEqual(["pv-P3"]);
  });

  it("ready: the bell asks a person once, and nothing more is made while it waits", async () => {
    const w = world();
    await w.run();
    w.outcomes.set(replacementOf(w)[0]!.id, { kind: "ready" });
    await w.run();
    await w.run();
    expect(w.bell).toEqual([{ category: "ads_creative_refresh", title: "A new ad awaits your approval", dedupe: `ads_creative_refresh:ready:${replacementOf(w)[0]!.id}` }]);
    expect([replacementOf(w).length, w.composed.length]).toEqual([1, 2]);
  });

  it("a rejected replacement is followed by one more from the next option; after 2 nothing is made and the bell says so once", async () => {
    const w = world({ keys: ["P1", "P2", "P3"] });
    await w.run();
    replacementOf(w)[0]!.state = "rejected";
    await w.run();
    expect(replacementOf(w).map((c) => c.preset_version_id)).toEqual(["pv-P3", "pv-P1"]);
    replacementOf(w)[1]!.state = "check_failed";
    await w.run();
    await w.run();
    expect(replacementOf(w).length).toBe(REFRESH_ATTEMPTS);
    expect(w.bell.map((b) => [b.title, b.dedupe])).toEqual([["No replacement for a retired ad", "ads_creative_refresh:none:cr-old"]]);
  });

  it("with the retired preset disabled and nothing unrun, nothing is invented: the bell says no preset can enter", async () => {
    const w = world({ enabled: { P1: false } });
    expect(await w.run()).toEqual({ ok: true });
    expect([replacementOf(w).length, w.bell[0]?.title]).toEqual([0, "No replacement for a retired ad"]);
  });
});

describe("refreshCampaign — an approved replacement is published and turned on", () => {
  const approvedWorld = (over: Parameters<typeof world>[0] = {}) => world({
    creatives: [cr("cr-old", "pv-P1", { platform_status: "retired" }), cr("cr-two", "pv-P2"), cr("cr-new", "pv-P1", { supersedes_id: "cr-old" })],
    approvals: [APPROVAL], ...over,
  });

  it("its ads join the campaign's refs, each is turned on with its own ledger row citing the person's approval, and the creative is marked active", async () => {
    const w = approvedWorld();
    expect(await w.run()).toEqual({ ok: true });
    expect(w.publishOne).toHaveBeenCalledWith(expect.objectContaining({ id: "c-1" }), "cr-new");
    const refs = w.campaigns[0]!.platform_refs as { meta_ad_ids: string[]; ads: Array<{ meta_ad_id: string }> };
    expect(refs.meta_ad_ids).toEqual(["9001", "9002", "950", "951"]);
    expect(refs.ads.map((a) => a.meta_ad_id)).toEqual(["9001", "9002", "950", "951"]);
    expect(w.activateAd.mock.calls.map((c) => (c as unknown as [{ ad: string; campaign: { platform_refs: { meta_ad_ids: string[] } } }])[0]).map((a) => [a.ad, a.campaign.platform_refs.meta_ad_ids.includes(a.ad)])).toEqual([["950", true], ["951", true]]);
    expect(w.actions.map((a) => [a.kind, a.approval_id, a.creative_id, a.status, a.idempotency_key])).toEqual([
      ["activate_ad", "ap-1", "cr-new", "succeeded", "activate_ad:c-1:950:0"], ["activate_ad", "ap-1", "cr-new", "succeeded", "activate_ad:c-1:951:0"],
    ]);
    expect(w.creatives.find((c) => c.id === "cr-new")!.platform_status).toBe("active");
    expectOrgScoped(w.rec, ORG);
  });

  it("once active, a re-run publishes and turns on nothing", async () => {
    const w = approvedWorld();
    await w.run();
    await w.run();
    expect([w.publishOne.mock.calls.length, w.activateAd.mock.calls.length, w.actions.length]).toEqual([1, 2, 2]);
  });

  it("an approval that was withdrawn is no approval: nothing is published", async () => {
    const w = approvedWorld({ approvals: [APPROVAL, { id: "ap-w", org_id: ORG, campaign_id: "c-1", creative_id: null, kind: "withdraw", withdraws_id: "ap-1", created_at: T0 }] });
    expect(await w.run()).toMatchObject({ ok: false, error: expect.stringContaining("without a standing approval") });
    expect([w.publishOne.mock.calls.length, w.activateAd.mock.calls.length]).toEqual([0, 0]);
  });

  it("a campaign that left `live` between the publish and the refs is given no ads and nothing is turned on", async () => {
    const w = approvedWorld({ campaignState: "pausing" });
    expect(await w.run()).toEqual({ ok: true });
    expect([w.activateAd.mock.calls.length, (w.campaigns[0]!.platform_refs as { meta_ad_ids: string[] }).meta_ad_ids.length]).toEqual([0, 2]);
  });

  it("a publish refusal no retry can change (an ad the campaign already holds) is final: marked, told once, never asked again", async () => {
    const w = approvedWorld();
    w.publishOne.mockResolvedValue({ ok: false, error_code: "adopted_existing_ad" } as never);
    for (let i = 0; i < 3; i++) await w.run();
    expect([w.publishOne.mock.calls.length, w.activateAd.mock.calls.length]).toEqual([1, 0]);
    expect(w.creatives.find((c) => c.id === "cr-new")!.platform_status).toBe("publish_failed");
    expect(w.bell.map((b) => b.title)).toEqual(["An approved ad could not be published"]);
  });

  it("a passing publish failure (a throttle) is retried on the next step, unmarked and unrung", async () => {
    const w = approvedWorld();
    w.publishOne.mockResolvedValueOnce({ ok: false, error_code: "rate_limited" } as never);
    expect(await w.run()).toMatchObject({ ok: false, error: expect.stringContaining("publish rate_limited") });
    expect([w.creatives.find((c) => c.id === "cr-new")!.platform_status, w.bell.length]).toEqual([null, 0]);
    expect(await w.run()).toEqual({ ok: true });
    expect(w.creatives.find((c) => c.id === "cr-new")!.platform_status).toBe("active");
  });

  it("a refused activation is a failed row and an error; after three the creative is marked and the bell rings, and no fourth call is made", async () => {
    const w = approvedWorld();
    w.activateAd.mockResolvedValue({ ok: false, error_code: "meta_100" } as never);
    for (let i = 0; i < 5; i++) await w.run();
    expect(w.activateAd.mock.calls.length).toBe(3);
    expect(w.actions.map((a) => [a.status, a.idempotency_key])).toEqual([0, 1, 2].map((n) => ["failed", `activate_ad:c-1:950:${n}`]));
    expect(w.creatives.find((c) => c.id === "cr-new")!.platform_status).toBe("activate_failed");
    expect(w.bell.map((b) => b.title)).toEqual(["An approved ad could not be turned on"]);
  });
});
