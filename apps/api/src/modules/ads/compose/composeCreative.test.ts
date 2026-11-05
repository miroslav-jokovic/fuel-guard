import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, REGENERATION_CLAUSES, type AdAssetRef, type AdBrandKit, type AdPresetRecipe, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import { composeCreative, union, type ComposeInput, type CreativeRow } from "./composeCreative.js";

/**
 * One creative through copy → art → render → overlay → visual check (C5b), against the real workers and the
 * real A4 rail, with a Claude that answers by tool name, a render step that is told what to answer, and
 * real images (the checker's corpus) for the render and the reference photo.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-04T18:00:00Z");
const IMAGES = new URL("../workers/checker/fixtures/images/", import.meta.url);
const jpg = (n: string) => readFileSync(new URL(`${n}.jpg`, IMAGES));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const copyFx = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const RECIPE: AdPresetRecipe = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, formats: ["4:5"], overlay_slots: { headline: "hook", cta: "cta" } };
const KIT: AdBrandKit = { ...artFx.input.kit, overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } }, people_policy: "none", forbidden_marks: ["ACME Logistics"] };
const RENDERED: AdAssetRef = { sha256: "d".repeat(64), format: "jpeg", source_format: "jpeg", width: 768, height: 960, byte_size: 1 };

const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { copywriter: true, art_director: true, checker: true } },
};

const pass = (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: "Looks right here.", verdict: "pass" }])) });
const failOn = (bad: string) => (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: c === bad ? "Lettering on the trailer side." : "Looks right here.", verdict: c === bad ? "fail" : "pass" }])) });

function harness(opts: { visual?: Array<(checks: readonly string[]) => unknown>; copy?: unknown; render?: (i: RenderInput) => RenderOutcome } = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${Math.random()}` }] : []),
      ads_creatives: [],
    },
  });
  const visual = [...(opts.visual ?? [pass])];
  const create = vi.fn(async (body: { tools: Array<{ name: string; input_schema: { properties: { checks?: { properties: object } } } }> }) => {
    const tool = body.tools[0]!;
    const input = tool.name === "write_copy" ? opts.copy ?? copyFx.recorded.output
      : tool.name === "direct_art" ? artFx.recorded.output
      : (visual.length > 1 ? visual.shift()! : visual[0]!)(Object.keys(tool.input_schema.properties.checks!.properties));
    return { id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: tool.name, input }], usage: { input_tokens: 100, output_tokens: 50 } };
  });
  const render = vi.fn(async (i: RenderInput): Promise<RenderOutcome> => opts.render?.(i) ?? { kind: "stored", generationId: `r-${i.attempt}`, assets: [RENDERED], replayed: false });
  const stored: Buffer[] = [];
  const deps = {
    admin: rec.client, client: { messages: { create } } as unknown as MessagesClient, now: () => NOW,
    render, renderModel: "fixture/model",
    readAsset: vi.fn(async (_org: string, ref: { sha256: string }) => (ref.sha256 === RENDERED.sha256 ? jpg("clean-highway") : jpg("reference"))),
    storeAsset: vi.fn(async (_org: string, bytes: Buffer): Promise<AdAssetRef> => {
      stored.push(bytes);
      const m = await sharp(bytes).metadata();
      return { sha256: sha(bytes), format: "png", source_format: "png", width: m.width!, height: m.height!, byte_size: bytes.length };
    }),
  };
  const creative: CreativeRow = { id: "cr-1", org_id: ORG, campaign_id: "c-1", state: "generating", regenerations: 0 };
  const input = (over: Partial<ComposeInput> = {}): ComposeInput => ({ creative, brief: copyFx.input.brief, recipe: RECIPE, kit: KIT, maxRegenerations: 1, ...over });
  const creativeWrites = () => rec.forTable("ads_creatives").filter((q) => q.write?.method === "update");
  const tools = () => create.mock.calls.map((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name);
  return { rec, deps, input, render, create, tools, stored, creativeWrites, run: (over?: Partial<ComposeInput>) => composeCreative(deps, input(over)) };
}

describe("composeCreative — a creative from copy to ready (C5b)", () => {
  it("a render still drawing answers pending and ends nothing; when it is stored the creative is ready with every format and language", async () => {
    let drawn = false;
    const h = harness({ render: (i) => (drawn ? { kind: "stored", generationId: "r", assets: [RENDERED], replayed: false } : { kind: "pending", generationId: "r", retryAfterSeconds: 5, why: `queued ${i.attempt}` }) });
    expect(await h.run()).toEqual({ kind: "pending", why: "render 1: queued 1" });
    expect(h.creativeWrites()).toEqual([]);
    drawn = true;
    expect(await h.run()).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!;
    expect(last.write!.payload).toMatchObject({ state: "ready", regenerations: 0, last_error: null, copy: copyFx.recorded.output });
    const assets = (last.write!.payload as { assets: Array<{ format: string; language: string; width: number; height: number }> }).assets;
    expect(assets.map((a) => `${a.format} ${a.language} ${a.width}x${a.height}`)).toEqual(["4:5 en 1080x1350", "4:5 es 1080x1350"]);
    expect((last.write!.payload as { checks: { visual: { ok: boolean } } }).checks.visual.ok).toBe(true);
    expectOrgScoped(h.rec, ORG);
  });

  it("the image checked is the framed still, before any text, beside the reference photo and the band the text covers", async () => {
    const h = harness();
    await h.run();
    const visualCall = h.create.mock.calls.find((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name === "report_checks")!;
    const images = ((visualCall[0] as unknown as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> }).messages[0]!.content).filter((b) => b.type === "image");
    const dims = await Promise.all(images.map(async (b) => { const m = await sharp(Buffer.from(b.source!.data, "base64")).metadata(); return [m.width, m.height]; }));
    expect(dims[0]).toEqual([1080, 1350]);
    expect(images[1]!.source!.data).toBe(jpg("reference").toString("base64"));
    // The band is the overlay's own text stack: the zone's width less its padding (886 px of 1080), shorter than the frame.
    expect(dims[2]![0]).toBe(886);
    expect(dims[2]![1]).toBeLessThan(700);
  });

  it("the render starts from the kit photo the Art director chose — the same photo the visual check compares against (D-AD9)", async () => {
    const h = harness();
    await h.run();
    const chosen = KIT.equipment_photos.find((p) => p.asset.sha256 === (artFx.recorded.output as { reference_photo: string }).reference_photo)!.asset;
    expect(h.render.mock.calls[0]![0].reference).toEqual({ sha256: chosen.sha256, format: chosen.format });
    const read = h.deps.readAsset.mock.calls.map((c) => c[1].sha256);
    expect(read).toContain(chosen.sha256);
  });

  it("a text-only scene renders from no photo", async () => {
    const textOnly = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "empty-cab-interior")!.fixture;
    const h = harness();
    h.create.mockImplementation((async (body: { tools: Array<{ name: string; input_schema: { properties: { checks?: { properties: object } } } }> }) => {
      const tool = body.tools[0]!;
      const input = tool.name === "write_copy" ? copyFx.recorded.output : tool.name === "direct_art" ? textOnly.recorded.output : pass(Object.keys(tool.input_schema.properties.checks!.properties));
      return { id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: tool.name, input }], usage: { input_tokens: 100, output_tokens: 50 } };
    }) as never);
    await h.run({ recipe: { ...textOnly.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, formats: ["4:5"], overlay_slots: { headline: "hook", cta: "cta" } }, kit: { ...KIT, ...textOnly.input.kit, overlays: KIT.overlays } });
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.render.mock.calls[0]![0].reference).toBeNull();
  });

  it("a visual fail regenerates once with our fixed clause in the prompt, under new keys, and a pass then is ready", async () => {
    const h = harness({ visual: [failOn("no_glyphs"), pass] });
    expect(await h.run()).toEqual({ kind: "ready" });
    expect(h.render.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2]);
    expect(String(h.render.mock.calls[0]![0].params.prompt)).not.toContain(REGENERATION_CLAUSES.no_glyphs);
    expect(String(h.render.mock.calls[1]![0].params.prompt)).toContain(REGENERATION_CLAUSES.no_glyphs);
    expect(String(h.render.mock.calls[1]![0].params.prompt)).not.toContain("Lettering on the trailer side");
    const keys = h.rec.writtenRows("ad_generations").map((r) => r.idempotency_key);
    expect(keys).toEqual(expect.arrayContaining(["art:cr-1:1", "art:cr-1:2", "visual:cr-1:4:5:1", "visual:cr-1:4:5:2"]));
    expect(h.creativeWrites().at(-1)!.write!.payload).toMatchObject({ state: "ready", regenerations: 1 });
  });

  it("a second visual fail stops with the reason, and no third render is asked", async () => {
    const h = harness({ visual: [failOn("no_glyphs"), failOn("no_glyphs")] });
    const out = await h.run();
    expect(out.kind).toBe("check_failed");
    expect(out.kind === "check_failed" && out.reason).toMatch(/visual check failed after 2 attempt\(s\): 4:5 no_glyphs: Lettering on the trailer side\./);
    expect(h.render).toHaveBeenCalledTimes(2);
    expect(h.creativeWrites().at(-1)!.write!.payload).toMatchObject({ state: "check_failed" });
    expect(h.stored).toEqual([]);
  });

  it("with no regenerations allowed the first visual fail stops", async () => {
    const h = harness({ visual: [failOn("safe_zone_clear")] });
    expect((await h.run({ maxRegenerations: 0 })).kind).toBe("check_failed");
    expect(h.render).toHaveBeenCalledTimes(1);
  });
});

describe("composeCreative — what stops at once, never regenerated", () => {
  it("copy with a figure the brief does not hold stops before any art or render", async () => {
    const bad = { en: { ...(copyFx.recorded.output as { en: object }).en, hook: "$0.95/mile for Class A drivers." }, es: (copyFx.recorded.output as { es: object }).es };
    const h = harness({ copy: bad });
    const out = await h.run();
    expect(out.kind === "check_failed" && out.reason).toMatch(/^copy check: /);
    expect(h.tools()).toEqual(["write_copy"]);
    expect(h.render).not.toHaveBeenCalled();
  });

  it("a preset that does not name the overlay's slots stops by name, asking no model", async () => {
    const h = harness();
    const out = await h.run({ recipe: { ...RECIPE, overlay_slots: null } });
    expect(out.kind === "check_failed" && out.reason).toMatch(/^no_overlay_slots/);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a render model nobody has priced stops visibly as price_unknown", async () => {
    const h = harness({ render: () => ({ kind: "refused", refusal: "price_unknown" }) });
    expect(await h.run()).toEqual({ kind: "check_failed", reason: "render: price_unknown" });
    expect(h.creativeWrites().at(-1)!.write!.payload).toMatchObject({ state: "check_failed", last_error: "render: price_unknown" });
  });

  it("with no still model chosen yet (V4) it stops at the render, asking Higgsfield nothing", async () => {
    const h = harness();
    expect(await composeCreative({ ...h.deps, renderModel: null }, h.input())).toEqual({ kind: "check_failed", reason: "render: no still model chosen yet (V4)" });
    expect(h.render).not.toHaveBeenCalled();
  });

  it("a format the brand kit has no overlay for stops as the render check, with no visual check asked", async () => {
    const h = harness();
    const out = await h.run({ kit: { ...KIT, overlays: {} } });
    expect(out.kind === "check_failed" && out.reason).toBe("render check (4:5, en): no_template");
    expect(h.tools()).not.toContain("report_checks");
  });

  it("a creative that already left the workers is not touched", async () => {
    const h = harness();
    expect(await h.run({ creative: { id: "cr-1", org_id: ORG, campaign_id: "c-1", state: "ready", regenerations: 0 } })).toEqual({ kind: "done", state: "ready" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.creativeWrites()).toEqual([]);
  });

  it("every write is guarded by the workers' states, so a re-run after the end changes nothing", async () => {
    const h = harness();
    await h.run();
    const [checking, end] = h.creativeWrites();
    expect(checking!.filters()).toEqual(expect.arrayContaining([{ col: "state", val: "generating" }]));
    expect(JSON.stringify(end!.filters())).toContain("checking");
  });
});

describe("union — the band both languages' text covers", () => {
  it("is the smallest rectangle holding every box, clipped to the frame", () => {
    expect(union([{ x: 0.1, y: 0.6, width: 0.5, height: 0.1 }, { x: 0.05, y: 0.7, width: 0.9, height: 0.4 }])).toEqual({ x: 0.05, y: 0.6, width: 0.9, height: 0.4 });
  });
});
