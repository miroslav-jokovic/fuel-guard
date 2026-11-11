import { createHash } from "node:crypto";
import { presentationOrder } from "../workers/craftJudge/craftJudge.js";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import { ADS_SETTINGS_UNSET, FRAME_CLAUSE, NO_LETTERING, QUIET_REGION, adCandidatesSchema, adCreativeChecksSchema, REGENERATION_CLAUSES, type AdAssetRef, type AdBrandKit, type AdPresetRecipe, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import { SIMULATED_STILL_MODEL } from "../creative/higgsfield/prices.js";
import { frameStill } from "../creative/overlay/overlay.js";
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
const copySet = copyFx.recorded.output as { candidates: Array<{ en: Record<string, string>; es: Record<string, string> }> };
/** With flat judge scores the order is the writer's, so the first candidate becomes the ad. */
const firstCandidate = copySet.candidates[0]!;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const RECIPE: AdPresetRecipe = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, formats: ["4:5"], overlay_slots: { headline: "hook", cta: "cta" } };
const KIT: AdBrandKit = { ...artFx.input.kit, overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } }, people_policy: "none", forbidden_marks: ["ACME Logistics"] };
const RENDERED: AdAssetRef = { sha256: "d".repeat(64), format: "jpeg", source_format: "jpeg", width: 768, height: 960, byte_size: 1 };

const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { copywriter: true, art_director: true, checker: true, craft_judge: true } },
};

/**
 * The writer and the review screen read one shape (Track S's finding, 11/06): every `checks` object a test
 * here makes compose write is parsed through `adCreativeChecksSchema`, the schema the review grid reads.
 * That schema is a `looseObject` on purpose (a key compose adds later must not blank the screen), so a
 * parse alone would let a renamed key through as an extra; the walk below also names every key the schema
 * does not hold, at any depth. A new key is added to the schema first, in the same PR.
 */
type Def = { type: string; shape?: Record<string, ZodType>; innerType?: ZodType; element?: ZodType; valueType?: ZodType };
function keysTheSchemaLacks(schema: ZodType, value: unknown, at = "checks"): string[] {
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def;
  if (def.type === "optional" || def.type === "nullable") return value == null ? [] : keysTheSchemaLacks(def.innerType!, value, at);
  if (def.type === "array" && Array.isArray(value)) return value.flatMap((v, i) => keysTheSchemaLacks(def.element!, v, `${at}[${i}]`));
  if (def.type === "record" && value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => keysTheSchemaLacks(def.valueType!, v, `${at}.${k}`));
  if (def.type !== "object" || !value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) => (def.shape![k] ? keysTheSchemaLacks(def.shape![k]!, v, `${at}.${k}`) : [`${at}.${k}`]));
}
let checksWritten = 0;
const recorders: Array<ReturnType<typeof createSupabaseRecorder>> = [];
afterEach(() => {
  for (const rec of recorders.splice(0)) {
    for (const q of rec.forTable("ads_creatives")) {
      const checks = (q.write?.payload as { checks?: unknown } | undefined)?.checks;
      // `null` (a stop before any check ran) is read before the schema: `creativeCheckGrid` answers it not_run.
      if (checks === undefined || checks === null) continue;
      checksWritten += 1;
      expect(adCreativeChecksSchema.safeParse(checks).error).toBeUndefined();
      expect(keysTheSchemaLacks(adCreativeChecksSchema, checks)).toEqual([]);
    }
  }
});
afterAll(() => {
  // Not vacuous: the file's tests make compose write checks this many times at least (8 measured 11/06).
  expect(checksWritten).toBeGreaterThanOrEqual(8);
});

const pass = (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: "Looks right here.", verdict: "pass" }])) });
const failOn = (bad: string) => (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: c === bad ? "Lettering on the trailer side." : "Looks right here.", verdict: c === bad ? "fail" : "pass" }])) });

function harness(opts: { settings?: AdsSettings; judge?: (n: number) => unknown; visual?: Array<(checks: readonly string[]) => unknown>; copy?: unknown; render?: (i: RenderInput) => RenderOutcome } = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: opts.settings ?? settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${Math.random()}` }] : []),
      ads_creatives: [],
    },
  });
  recorders.push(rec);
  const visual = [...(opts.visual ?? [pass])];
  const create = vi.fn(async (body: { tools: Array<{ name: string; input_schema: { properties: { checks?: { properties: object } } } }> }) => {
    const tool = body.tools[0]!;
    const input = tool.name === "write_copy" ? opts.copy ?? copyFx.recorded.output
      : tool.name === "judge_copy" ? (opts.judge ?? ((n: number) => ({ scores: Array.from({ length: n }, () => ({ reason: "fixture", scores: { hook: 3, specific: 3, plain: 3, spanish: 3, no_filler: 3 } })) })))((tool.input_schema as unknown as { properties: { scores: { minItems: number } } }).properties.scores.minItems)
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
    // The only row written before the render is the candidates set (CQ4): what was written and how it was ranked exists
    // before any picture does, so a stop at the render still shows it.
    expect(h.creativeWrites().map((w) => Object.keys(w.write!.payload as object))).toEqual([["candidates"]]);
    drawn = true;
    expect(await h.run()).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!;
    expect(last.write!.payload).toMatchObject({ state: "ready", regenerations: 0, last_error: null, copy: firstCandidate });
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

  it("the band the visual check judges follows the preset's layout: a top_band preset sends a different band from a bottom_plate one, the same height (CQ6)", async () => {
    const bandOf = async (layout: AdPresetRecipe["layout"]) => {
      const h = harness();
      await h.run({ recipe: { ...RECIPE, layout } });
      const visualCall = h.create.mock.calls.find((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name === "report_checks")!;
      const images = ((visualCall[0] as unknown as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> }).messages[0]!.content).filter((b) => b.type === "image");
      const data = images[2]!.source!.data;
      const meta = await sharp(Buffer.from(data, "base64")).metadata();
      return { data, height: meta.height! };
    };
    const top = await bandOf("top_band");
    const bottom = await bandOf("bottom_plate");
    // The same words make the same stack, so the bands are the same height — but compose reads the overlay's PLACED
    // boxes, so the layout decides which pixels the checker looks at.
    expect(top.height).toBe(bottom.height);
    expect(top.data).not.toBe(bottom.data);
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

describe("composeCreative — only the formats an ad is shown in (Q-AD75; D-AD25)", () => {
  it("a 9:16 the kit cannot even overlay does not fail the ad: only the published format is framed, checked and stored", async () => {
    // KIT has an overlay for 4:5 alone, so a 9:16 that was still framed would refuse `no_template` — the format
    // no placement shows would stop the creative, as every unused crop could before the ruling.
    const h = harness();
    expect(await h.run({ recipe: { ...RECIPE, formats: ["9:16", "4:5"] } })).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { assets: Array<{ format: string; language: string }>; checks: { visual: { results: Record<string, unknown> } } };
    expect(last.assets.map((a) => `${a.format} ${a.language}`)).toEqual(["4:5 en", "4:5 es"]);
    expect(Object.keys(last.checks.visual.results)).toEqual(["4:5"]);
    expect(h.tools().filter((t) => t === "report_checks")).toHaveLength(1);
    expect(h.stored).toHaveLength(2);
  });

  it("a preset holding 4:5 and 1:1 is made in both, best first", async () => {
    const h = harness();
    const kit = { ...KIT, overlays: { ...KIT.overlays, "1:1": KIT.overlays["4:5"]! } };
    expect(await h.run({ kit, recipe: { ...RECIPE, formats: ["1:1", "9:16", "4:5"] } })).toEqual({ kind: "ready" });
    const assets = (h.creativeWrites().at(-1)!.write!.payload as { assets: Array<{ format: string; language: string }> }).assets;
    expect(assets.map((a) => `${a.format} ${a.language}`)).toEqual(["4:5 en", "4:5 es", "1:1 en", "1:1 es"]);
  });

  it("a stored preset of 9:16 alone stops by name before the copywriter is asked or a picture is drawn", async () => {
    const h = harness();
    const out = await h.run({ recipe: { ...RECIPE, formats: ["9:16"] } });
    expect(out).toEqual({ kind: "check_failed", reason: "no_feed_format: the preset's formats (9:16) hold none an ad is shown in" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.render).not.toHaveBeenCalled();
    expect(h.creativeWrites().at(-1)!.write!.payload).toMatchObject({ state: "check_failed", last_error: out.kind === "check_failed" ? out.reason : "" });
  });
});

describe("composeCreative — the copy that ships is the best-ranked one the overlay can draw (AG1; D-AD26)", () => {
  /** Too long for two lines at the headline's size on 4:5 (measured: nothing over 56 characters fits). */
  const LONG = "Drive regional flatbed for a carrier that pays every mile and gets you home each weekend";
  const withLongHook = (which: number[], language: "en" | "es" = "en") => ({
    candidates: copySet.candidates.map((c, i) => (which.includes(i) ? { ...c, [language]: { ...c[language], hook: LONG } } : c)),
  });
  // A 90-character hook must pass the copywriter's own length check to reach the overlay at all.
  const ROOMY: AdPresetRecipe = { ...RECIPE, copy_slots: RECIPE.copy_slots.map((s) => (s.name === "hook" ? { ...s, max_chars: 120 } : s)) };

  it("the first-ranked copy needs a third line: the next one becomes the ad, the row says why, and no picture was drawn for the first", async () => {
    const h = harness({ copy: withLongHook([0]) });
    expect(await h.run({ recipe: ROOMY })).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { copy: unknown; candidates: { chosen: number; passed_over?: Array<{ index: number; reason: string }>; ranked: Array<{ offered_as: number }> } };
    expect(last.candidates.ranked[0]!.offered_as).toBe(0);
    expect(last.candidates.chosen).toBe(1);
    expect(last.candidates.passed_over).toEqual([{ index: 0, reason: "4:5, en: too_long" }]);
    expect(last.copy).toEqual(copySet.candidates[1]);
    // One render, and the art director was asked once: nothing was drawn to find out the first copy did not fit.
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.tools().filter((t) => t === "direct_art")).toHaveLength(1);
    expect(adCandidatesSchema.safeParse(last.candidates).error).toBeUndefined();
  });

  it("a copy that fits in English and not in Spanish is passed over too: the ad is made in both", async () => {
    const h = harness({ copy: withLongHook([0], "es") });
    expect(await h.run({ recipe: ROOMY })).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { candidates: { chosen: number; passed_over?: Array<{ index: number; reason: string }> } };
    expect(last.candidates).toMatchObject({ chosen: 1, passed_over: [{ index: 0, reason: "4:5, es: too_long" }] });
  });

  it("when the first copy fits, it is the ad and nothing is recorded as passed over", async () => {
    const h = harness();
    await h.run();
    const last = h.creativeWrites().at(-1)!.write!.payload as { candidates: Record<string, unknown> };
    expect(last.candidates.chosen).toBe(0);
    expect(last.candidates).not.toHaveProperty("passed_over");
  });

  it("no copy fits: the creative stops with every copy's reason, keeps the ranked set, and asks for no art and no picture", async () => {
    const h = harness({ copy: withLongHook([0, 1, 2]) });
    const out = await h.run({ recipe: ROOMY });
    expect(out).toEqual({ kind: "check_failed", reason: "render check: none of the 3 copies fits the image — #1 (4:5, en: too_long) · #2 (4:5, en: too_long) · #3 (4:5, en: too_long)" });
    expect(h.render).not.toHaveBeenCalled();
    expect(h.tools()).not.toContain("direct_art");
    const writes = h.creativeWrites().map((w) => w.write!.payload as { candidates?: { passed_over?: unknown[] }; checks?: { render?: { ok: boolean; format: string; language: string; findings: Array<{ kind: string }> } } });
    expect(writes[0]!.candidates!.passed_over).toHaveLength(3);
    expect(writes.at(-1)!.checks!.render).toMatchObject({ ok: false, format: "4:5", language: "en", findings: [{ kind: "too_long", label: "headline", max_lines: 2 }] });
  });

  it("the art director is handed the headline that will be drawn — the chosen copy's, not the first-ranked one's — and the render's prompt is composed (AG3)", async () => {
    const h = harness({ copy: withLongHook([0]) });
    await h.run({ recipe: ROOMY });
    const artCall = h.create.mock.calls.find((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name === "direct_art")!;
    const sent = JSON.parse((artCall[0] as unknown as { messages: Array<{ content: string }> }).messages[0]!.content) as { headline: string; composition: { kept_plain: string } };
    expect(sent.headline).toBe(copySet.candidates[1]!.en.hook);
    expect(sent.composition.kept_plain).toBe(QUIET_REGION.bottom_plate.where);
    const prompt = (h.render.mock.calls[0]![0] as RenderInput).params.prompt as string;
    expect(prompt).toContain(QUIET_REGION.bottom_plate.clause);
    expect(prompt).toContain(FRAME_CLAUSE["4:5"]);
    expect(prompt.endsWith(NO_LETTERING)).toBe(true);
  });

  it("a kit with no overlay for the format is the kit's refusal: no copy is called passed over for it", async () => {
    const h = harness();
    await h.run({ kit: { ...KIT, overlays: {} } });
    const kept = h.creativeWrites()[0]!.write!.payload as { candidates: Record<string, unknown> };
    expect(kept.candidates).not.toHaveProperty("passed_over");
  });
});

describe("composeCreative — one picture in the published frame, the shorter frame cut from it (AG4; Q-AD75)", () => {
  it("a model with a documented frame field is asked for the first published format's shape; one without is sent the prompt alone", async () => {
    const asked = async (model: string, formats: AdPresetRecipe["formats"]) => {
      const h = harness();
      h.deps.renderModel = model;
      const kit = { ...KIT, overlays: { ...KIT.overlays, "1:1": KIT.overlays["4:5"]! } };
      await h.run({ kit, recipe: { ...RECIPE, formats } });
      return Object.keys((h.render.mock.calls[0]![0] as RenderInput).params).sort().map((k) => `${k}=${k === "prompt" ? "…" : String((h.render.mock.calls[0]![0] as RenderInput).params[k])}`);
    };
    expect(await asked(SIMULATED_STILL_MODEL, ["1:1", "9:16", "4:5"])).toEqual(["aspect_ratio=4:5", "prompt=…"]);
    expect(await asked(SIMULATED_STILL_MODEL, ["1:1"])).toEqual(["aspect_ratio=1:1", "prompt=…"]);
    expect(await asked("fixture/model", ["4:5"])).toEqual(["prompt=…"]);
  });

  it("the square is cut keeping the edge the preset's layout puts the words against: what the checker is shown is that cut, not the centre", async () => {
    const shown = async (layout: AdPresetRecipe["layout"]) => {
      const h = harness();
      await h.run({ kit: { ...KIT, overlays: { "1:1": KIT.overlays["4:5"]! } }, recipe: { ...RECIPE, formats: ["1:1"], layout } });
      const visualCall = h.create.mock.calls.find((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name === "report_checks")!;
      const image = ((visualCall[0] as unknown as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> }).messages[0]!.content).find((b) => b.type === "image")!;
      return image.source!.data;
    };
    const cut = async (layout: AdPresetRecipe["layout"]) => (await frameStill(jpg("clean-highway"), "1:1", layout)).toString("base64");
    // The fixture picture is 4:5, so a square cut removes rows and the three layouts keep three different parts.
    expect(new Set([await cut("bottom_plate"), await cut("top_band"), await cut("centered")]).size).toBe(3);
    for (const layout of ["bottom_plate", "top_band", "centered"] as const) expect(await shown(layout), layout).toBe(await cut(layout));
  });
});

describe("composeCreative — candidates and the craft judge (CQ4; D-AD19, D-AD21)", () => {
  const scored = (totals: number[]) => (n: number) => ({ scores: Array.from({ length: n }, (_, pos) => ({ reason: `pos ${pos}`, scores: { hook: totals[pos]!, specific: totals[pos]!, plain: totals[pos]!, spanish: totals[pos]!, no_filler: totals[pos]! } })) });
  /** The judge answers in the SHOWN order; this gives candidate `best` (writer's index) the top score whatever position it was shown at. */
  const favouring = (best: number) => (n: number) => {
    const presented = presentationOrder("cr-1", n);
    return { scores: presented.map((candidate) => ({ reason: candidate === best ? "the strongest" : "weaker", scores: Object.fromEntries(["hook", "specific", "plain", "spanish", "no_filler"].map((k) => [k, candidate === best ? 5 : 2])) })) };
  };

  it("the judge's top-ranked candidate becomes the copy — not the writer's first — and the whole ranked set is stored with scores and reasons", async () => {
    const h = harness({ judge: favouring(2) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { copy: unknown; candidates: { ranked: Array<{ offered_as: number; total: number | null; judged: { reason: string } | null }>; chosen: number; judge: string | null; offered: number; passed: number } };
    expect(last.copy).toEqual(copySet.candidates[2]);
    expect(last.candidates.ranked[0]).toMatchObject({ offered_as: 2, total: 25, judged: { reason: "the strongest" } });
    expect(last.candidates.ranked.map((r) => r.total)).toEqual([25, 10, 10]);
    expect(last.candidates).toMatchObject({ chosen: 0, judge: "craftJudge@1", offered: 3, passed: 3 });
    expect(h.tools().slice(0, 2)).toEqual(["write_copy", "judge_copy"]);
  });

  it("a candidate refused for a figure the brief does not hold is dropped before the judge sees it; the rest go on", async () => {
    const withOneBad = { candidates: copySet.candidates.map((c, i) => (i === 0 ? { en: { ...c.en, hook: "$0.95/mile for Class A drivers." }, es: c.es } : c)) };
    const h = harness({ copy: withOneBad, judge: scored([3, 3]) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { candidates: { ranked: Array<{ offered_as: number }>; offered: number; passed: number } };
    expect(last.candidates).toMatchObject({ offered: 3, passed: 2 });
    expect(last.candidates.ranked.map((r) => r.offered_as).sort()).toEqual([1, 2]);
    // The judge was asked about two, not three.
    const judgeCall = h.create.mock.calls.find((c) => (c[0] as { tools: Array<{ name: string }> }).tools[0]!.name === "judge_copy")!;
    expect(JSON.parse((judgeCall[0] as unknown as { messages: Array<{ content: string }> }).messages[0]!.content).candidates).toHaveLength(2);
  });

  it("with the craft judge switched off, the order is the writer's and the set says nobody ranked it", async () => {
    const off: AdsSettings = { ...settings, budgets: { ...settings.budgets, agents_enabled: { copywriter: true, art_director: true, checker: true } } };
    const h = harness({ settings: off });
    expect(await h.run()).toEqual({ kind: "ready" });
    const last = h.creativeWrites().at(-1)!.write!.payload as { copy: unknown; candidates: { judge: string | null; ranked: Array<{ total: number | null }> } };
    expect(last.copy).toEqual(copySet.candidates[0]);
    expect(last.candidates.judge).toBeNull();
    expect(last.candidates.ranked.every((r) => r.total === null)).toBe(true);
    expect(h.tools()).not.toContain("judge_copy");
  });

  it("one surviving candidate is not sent to the judge: there is nothing to rank", async () => {
    const h = harness({ copy: { candidates: [copySet.candidates[0]] } });
    expect(await h.run({ candidates: 1 })).toEqual({ kind: "ready" });
    expect(h.tools()).not.toContain("judge_copy");
  });

  it("an answer with fewer candidates than asked is off-schema, not quietly accepted", async () => {
    const h = harness({ copy: { candidates: [copySet.candidates[0]] } });
    expect((await h.run({ candidates: 3 })).kind).toBe("check_failed");
    expect(h.tools()).toEqual(["write_copy"]);
  });
});

describe("composeCreative — what stops at once, never regenerated", () => {
  it("copy with a figure the brief does not hold stops before any art or render", async () => {
    const bad = { candidates: copySet.candidates.map((c) => ({ en: { ...c.en, hook: "$0.95/mile for Class A drivers." }, es: c.es })) };
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
    const [candidates, checking, end] = h.creativeWrites();
    // The candidates are kept while the workers hold the creative (CQ4), under the same guard as every other write.
    expect(JSON.stringify(candidates!.filters())).toContain("generating");
    expect(Object.keys(candidates!.write!.payload as object)).toEqual(["candidates"]);
    expect(checking!.filters()).toEqual(expect.arrayContaining([{ col: "state", val: "generating" }]));
    expect(JSON.stringify(end!.filters())).toContain("checking");
  });
});

describe("union — the band both languages' text covers", () => {
  it("is the smallest rectangle holding every box, clipped to the frame", () => {
    expect(union([{ x: 0.1, y: 0.6, width: 0.5, height: 0.1 }, { x: 0.05, y: 0.7, width: 0.9, height: 0.4 }])).toEqual({ x: 0.05, y: 0.6, width: 0.9, height: 0.4 });
  });
});
