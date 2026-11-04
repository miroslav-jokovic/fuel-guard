import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, drawPresets, type AdsSettings } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import type { CampaignRow } from "../orchestrator/transitions.js";
import type { ComposeOutcome } from "./composeCreative.js";

/**
 * The campaign's compose step (C5b2): the draw, the batch, a creative per preset in this stint, the verdict.
 * `composeCreative` is replaced — its own suite proves one creative — so these tests see only the campaign's part.
 */
const outcomes = new Map<string, ComposeOutcome>();
const composed: Array<{ id: string; preset: string; maxRegenerations: number }> = [];
vi.mock("./composeCreative.js", async (orig) => ({
  ...(await orig<object>()),
  composeCreative: vi.fn(async (_deps: unknown, input: { creative: { id: string; preset_version_id: string }; maxRegenerations: number }) => {
    composed.push({ id: input.creative.id, preset: input.creative.preset_version_id, maxRegenerations: input.maxRegenerations });
    return outcomes.get(input.creative.preset_version_id) ?? { kind: "ready" };
  }),
}));
const { composeCampaign, stintCreativeId, BATCH } = await import("./composeCampaign.js");

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-04T18:00:00Z");
const STINT = "2026-11-04T17:00:00.000Z";
const copyFx = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const recipe = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, overlay_slots: { headline: "hook", cta: "cta" } };
const settings: AdsSettings = { ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, max_regenerations: 1 } };
const campaign: CampaignRow = { id: "c-1", org_id: ORG, connection_id: "conn", state: "composing", state_changed_at: STINT, daily_budget_cents: null, lifetime_cap_cents: null, platform_refs: {} };

const PRESETS = ["P1", "P2", "P3"].map((key, i) => ({ id: `p-${i}`, key, version: `pv-${i}` }));
const isWrite = (q: RecordedQuery) => q.write !== null;
const has = (q: RecordedQuery, col: string) => q.filters().some((f) => f.col === col);

function world(opts: { draw?: unknown; kits?: number; creatives?: unknown[]; liveCampaigns?: string[]; liveCreatives?: unknown[]; insertError?: unknown; enabled?: boolean } = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      ads_campaigns: (q) => {
        if (q.write) return [{ preset_draw: (q.write.payload as { preset_draw: unknown }).preset_draw }];
        if (has(q, "brief_ref")) return (opts.liveCampaigns ?? []).map((id) => ({ id }));
        return [{ brief_ref: "fixture-opening@v1", brief_snapshot: copyFx.input.brief, preset_draw: opts.draw ?? null }];
      },
      ad_brand_kits: Array.from({ length: opts.kits ?? 1 }, (_, i) => ({ id: `k-${i}`, name: "Kit", archived_at: null })),
      ad_brand_kit_versions: (q) => {
        const ids = (q.filters().find((f) => f.col === "kit_id")?.val ?? []) as string[];
        return ids.map((id) => ({ id: `kv-${id}`, kit_id: id, version: 1, kit: { ...artFx.input.kit, overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } } }, created_at: NOW.toISOString(), created_by_name: "X" }));
      },
      ad_concept_presets: PRESETS.map((p) => ({ id: p.id, key: p.key, archived_at: null })),
      ad_concept_preset_versions: (q) => {
        if (has(q, "preset_id")) return PRESETS.map((p) => ({ id: p.version, preset_id: p.id, version: 1, recipe, enabled: opts.enabled ?? true, created_at: NOW.toISOString(), created_by_name: "X" }));
        const asked = (q.filters().find((f) => f.col === "id")?.val ?? []) as string[];
        return PRESETS.filter((p) => asked.includes(p.version)).map((p) => ({ id: p.version, preset_id: p.id }));
      },
      ads_settings_versions: [{ id: "v1", settings, kill_switch: false }],
      ads_creatives: (q) => {
        if (q.write?.method === "insert") {
          if (opts.insertError) return { data: null, error: opts.insertError, writeError: opts.insertError };
          const p = q.write.payload as Record<string, unknown>;
          return [{ ...p, regenerations: 0, created_at: NOW.toISOString(), last_error: null }];
        }
        if (has(q, "campaign_id") && Array.isArray(q.filters().find((f) => f.col === "campaign_id")!.val)) return opts.liveCreatives ?? [];
        if (has(q, "id")) return [{ id: q.filters().find((f) => f.col === "id")!.val, org_id: ORG, campaign_id: "c-1", preset_version_id: "pv-0", state: "generating", regenerations: 0, created_at: NOW.toISOString(), last_error: null }];
        return opts.creatives ?? [];
      },
    },
  });
  return rec;
}
const deps = (rec: ReturnType<typeof world>) => ({ admin: rec.client } as unknown as Parameters<typeof composeCampaign>[0]);
const order = drawPresets("c-1", PRESETS.map((p) => ({ version_id: p.version, key: p.key, enabled: true })), []).order;

beforeEach(() => { outcomes.clear(); composed.length = 0; });

describe("composeCampaign — the draw and the batch (D-AD11)", () => {
  it("draws with the campaign id as the seed, stores the draw while none is stored, and composes the first two in its order", async () => {
    const rec = world();
    expect(await composeCampaign(deps(rec), campaign)).toEqual({ ok: true });
    const write = rec.forTable("ads_campaigns").find(isWrite)!;
    expect((write.write!.payload as { preset_draw: { seed: string; order: string[] } }).preset_draw).toMatchObject({ seed: "c-1", order });
    expect(write.ops.some((o) => o.method === "is" && o.args[0] === "preset_draw" && o.args[1] === null)).toBe(true);
    expect(composed.map((c) => c.preset)).toEqual(order.slice(0, BATCH));
    expect(composed.every((c) => c.maxRegenerations === 1)).toBe(true);
    expectOrgScoped(rec, ORG);
  });

  it("keeps a stored draw and draws nothing again", async () => {
    const stored = { seed: "c-1", eligible: ["pv-2", "pv-1"], excluded_live: [], order: ["pv-2", "pv-1"], exhausted: false };
    const rec = world({ draw: stored });
    await composeCampaign(deps(rec), campaign);
    expect(rec.forTable("ads_campaigns").filter(isWrite)).toEqual([]);
    expect(composed.map((c) => c.preset)).toEqual(["pv-2", "pv-1"]);
  });

  it("leaves out a preset a live campaign for the same brief runs", async () => {
    const rec = world({ liveCampaigns: ["c-9"], liveCreatives: [{ preset_version_id: "pv-0" }] });
    await composeCampaign(deps(rec), campaign);
    const draw = (rec.forTable("ads_campaigns").find(isWrite)!.write!.payload as { preset_draw: { excluded_live: string[]; order: string[] } }).preset_draw;
    expect(draw.excluded_live).toEqual(["P1"]);
    expect(draw.order).not.toContain("pv-0");
  });

  it("stops when no preset is left to draw", async () => {
    const out = await composeCampaign(deps(world({ enabled: false })), campaign);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/^no preset to draw/) });
    expect(composed).toEqual([]);
  });

  it("stops with no brand kit, or with more than one, before drawing anything", async () => {
    expect(await composeCampaign(deps(world({ kits: 0 })), campaign)).toEqual({ ok: false, error: "no brand kit saved yet (Q-AD14)" });
    expect(await composeCampaign(deps(world({ kits: 2 })), campaign)).toEqual({ ok: false, error: "2 brand kits: which one this campaign uses is not chosen" });
    expect(composed).toEqual([]);
  });
});

describe("composeCampaign — a creative per preset in this stint", () => {
  it("inserts each with an id made from campaign, preset and stint, under the kit's version", async () => {
    const rec = world();
    await composeCampaign(deps(rec), campaign);
    const rows = rec.writtenRows("ads_creatives");
    expect(rows.map((r) => r.id)).toEqual(order.slice(0, BATCH).map((p) => stintCreativeId("c-1", p, STINT)));
    expect(rows[0]).toMatchObject({ campaign_id: "c-1", state: "generating", brand_kit_version_id: "kv-k-0", supersedes_id: null });
  });

  it("an insert another run won (23505) reads that run's row instead of failing", async () => {
    const rec = world({ insertError: { code: "23505", message: "duplicate key" } });
    expect(await composeCampaign(deps(rec), campaign)).toEqual({ ok: true });
    expect(composed).toHaveLength(BATCH);
  });

  it("this stint's own row is moved again whatever its state, never replaced", async () => {
    const mine = { id: stintCreativeId("c-1", order[0]!, STINT), org_id: ORG, campaign_id: "c-1", preset_version_id: order[0], state: "check_failed", regenerations: 1, created_at: "2026-11-04T16:59:59Z", last_error: "visual" };
    const rec = world({ creatives: [mine] });
    await composeCampaign(deps(rec), campaign);
    expect(rec.writtenRows("ads_creatives").map((r) => r.preset_version_id)).toEqual([order[1]]);
    expect(composed[0]!.id).toBe(mine.id);
  });

  it("a creative that ended badly in an earlier stint is superseded by a new one in this stint", async () => {
    const old = { id: "old-1", org_id: ORG, campaign_id: "c-1", preset_version_id: order[0], state: "check_failed", regenerations: 1, created_at: "2026-11-03T10:00:00Z", last_error: "visual" };
    const rec = world({ creatives: [old] });
    await composeCampaign(deps(rec), campaign);
    expect(rec.writtenRows("ads_creatives")[0]).toMatchObject({ preset_version_id: order[0], supersedes_id: "old-1" });
  });

  it("a ready creative from an earlier stint is kept, not redone", async () => {
    const ok = { id: "ready-1", org_id: ORG, campaign_id: "c-1", preset_version_id: order[0], state: "ready", regenerations: 0, created_at: "2026-11-03T10:00:00Z", last_error: null };
    const rec = world({ creatives: [ok] });
    await composeCampaign(deps(rec), campaign);
    expect(rec.writtenRows("ads_creatives").map((r) => r.preset_version_id)).toEqual([order[1]]);
  });
});

describe("composeCampaign — the campaign's verdict", () => {
  it("any creative still under way keeps the campaign composing", async () => {
    outcomes.set(order[0]!, { kind: "pending", why: "render 1: render job queued" });
    expect(await composeCampaign(deps(world()), campaign)).toMatchObject({ ok: false, pending: true, why: expect.stringContaining("render 1: render job queued") });
  });

  it("one ready creative is enough for review", async () => {
    outcomes.set(order[0]!, { kind: "check_failed", reason: "visual check failed after 2 attempt(s)" });
    expect(await composeCampaign(deps(world()), campaign)).toEqual({ ok: true });
  });

  it("none ready fails the compose with every creative's reason", async () => {
    outcomes.set(order[0]!, { kind: "check_failed", reason: "render: price_unknown" });
    outcomes.set(order[1]!, { kind: "check_failed", reason: "render: no still model chosen yet (V4)" });
    expect(await composeCampaign(deps(world()), campaign)).toEqual({ ok: false, error: "no creative passed its checks: render: price_unknown | render: no still model chosen yet (V4)" });
  });
});
