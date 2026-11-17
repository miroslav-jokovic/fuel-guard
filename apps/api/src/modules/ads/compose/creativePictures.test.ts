import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADS_SETTINGS_UNSET, FINISHED_AD_CRITERIA, adCandidatesSchema, adCreativeChecksSchema, adPairingsSchema,
  type AdAssetRef, type AdBrandKit, type AdPairings, type AdPresetRecipe, type AdsSettings,
} from "@silvicom/shared";
import type { MessagesClient } from "../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import type { RenderInput, RenderOutcome } from "../creative/higgsfield/render.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";
import { composeCreative, pictureCount, type ComposeInput, type CreativeRow } from "./composeCreative.js";

/**
 * One creative chosen from SEVERAL pictures (ADS-PLATFORM-V2-PLAN V3 "make many, show few"; Q-APX7), through the
 * real workers and the real A4 rail, as `composeCreative.test.ts` does for one picture: a Claude that answers by
 * tool name — here by the order it is asked, so each picture can be directed differently and each pairing scored
 * differently — a render that is told what to answer, and real images.
 *
 * The order the models are asked in is the code's and is what these tests lean on: the pictures in turn (each: its
 * direction, then per published format one visual check), then the pairings picture by picture and, within a
 * picture, in the craft judge's order of the words.
 */
/**
 * The overlay is the real one. One thing it almost never does on these images is refuse words for contrast — the
 * scrim is measured per picture until the words read — so the tests that need "these words cannot be drawn on this
 * picture" say which headline to refuse, and every other call goes through untouched.
 */
const refuseHeadline = vi.hoisted(() => ({ when: null as null | ((headline: string) => boolean) }));
vi.mock("../creative/overlay/overlay.js", async (original) => {
  const real = await original<typeof import("../creative/overlay/overlay.js")>();
  return {
    ...real,
    renderOverlay: (input: Parameters<typeof real.renderOverlay>[0]) => (refuseHeadline.when?.(input.headline)
      ? Promise.resolve({ kind: "refused" as const, findings: [{ kind: "low_contrast" }] as never })
      : real.renderOverlay(input)),
  };
});
/**
 * `makeMotion` is told what to answer here: what it does with a clip is `creativeMotion.test.ts`'s, against a real
 * ffmpeg. These tests are about WHEN compose asks for a motion ad, with what, and what it writes for each answer.
 */
const motion = vi.hoisted(() => ({ calls: [] as Array<{ deps: Record<string, unknown>; input: Record<string, unknown> }>, answer: null as unknown }));
vi.mock("./creativeMotion.js", () => ({
  makeMotion: async (deps: Record<string, unknown>, input: Record<string, unknown>) => { motion.calls.push({ deps, input }); return motion.answer; },
}));
afterEach(() => { refuseHeadline.when = null; motion.calls = []; motion.answer = null; });

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-16T18:00:00Z");
vi.setConfig({ testTimeout: 60_000 });

const IMAGES = new URL("../workers/checker/fixtures/images/", import.meta.url);
const jpg = (n: string) => readFileSync(new URL(`${n}.jpg`, IMAGES));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const copyFx = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const RECIPE: AdPresetRecipe = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, formats: ["4:5", "1:1"], overlay_slots: { headline: "hook", cta: "cta" } };
const OVERLAY = { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" };
const KIT: AdBrandKit = { ...artFx.input.kit, overlays: { "4:5": OVERLAY, "1:1": OVERLAY }, people_policy: "none", forbidden_marks: ["ACME Logistics"] };
const RENDERED: AdAssetRef = { sha256: "d".repeat(64), format: "jpeg", source_format: "jpeg", width: 768, height: 960, byte_size: 1 };
const WORDS = (copyFx.recorded.output as { candidates: unknown[] }).candidates.length;

const AGENTS = { copywriter: true, art_director: true, checker: true, craft_judge: true, finished_ad_judge: true };
const settingsWith = (agents: Record<string, boolean>): AdsSettings => ({ ...ADS_SETTINGS_UNSET, budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 5_000_000, agents_enabled: agents } });

/** The recorded direction with its hour changed, so each picture of an ad is a different one. */
const art = (hour: string) => ({ ...(artFx.recorded.output as object), slots: { ...(artFx.recorded.output as { slots: Record<string, string> }).slots, time_of_day: hour } });
const HOURS = ["golden hour on a late-summer evening", "first light on a clear autumn morning", "dusk under the yard lights in early spring", "a bright winter noon after snow", "blue hour on a summer night"];
/** Scores that add up to `total` (4 to 20). */
const finished = (total: number) => ({ scores: Object.fromEntries(FINISHED_AD_CRITERIA.map((c, i) => [c, { reason: `Fixture reason for ${c}.`, score: Math.floor(total / 4) + (i < total % 4 ? 1 : 0) }])) });
const passAll = (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: "Looks right here.", verdict: "pass" }])) });
const failLettering = (checks: readonly string[]) => ({ checks: Object.fromEntries(checks.map((c) => [c, { reason: c === "no_glyphs" ? "Lettering on the trailer side." : "Looks right here.", verdict: c === "no_glyphs" ? "fail" : "pass" }])) });

interface Opts {
  agents?: Record<string, boolean>;
  /** The n-th direction asked (0-based); default: a different hour each time. */
  art?: (n: number) => unknown;
  /** The n-th visual check asked; default: every item passes. */
  visual?: (n: number, checks: readonly string[]) => unknown;
  /** The n-th finished ad judged; default: 16 of 20 every time. */
  finished?: (n: number) => unknown;
  render?: (i: RenderInput) => RenderOutcome | undefined;
}

function harness(opts: Opts = {}) {
  const rec = createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: settingsWith(opts.agents ?? AGENTS), kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: `gen-${Math.random()}` }] : []),
      ads_creatives: [],
    },
  });
  const asked = { direct_art: 0, report_checks: 0, judge_finished_ad: 0 };
  const sent: Array<{ tool: string; body: string }> = [];
  const create = vi.fn(async (body: { tools: Array<{ name: string; input_schema: { properties: { checks?: { properties: object }; scores?: { minItems: number } } } }>; messages: Array<{ content: string | Array<{ type: string; text?: string }> }> }) => {
    const tool = body.tools[0]!;
    const content = body.messages[0]!.content;
    sent.push({ tool: tool.name, body: typeof content === "string" ? content : content.map((b) => b.text ?? "").join("") });
    const input = tool.name === "write_copy" ? copyFx.recorded.output
      // Falling scores in the order the judge is SHOWN the copies, which is not the writer's (`presentationOrder`):
      // the craft rank therefore differs from the writer's order, and the two indexes below are told apart.
      : tool.name === "judge_copy" ? { scores: Array.from({ length: tool.input_schema.properties.scores!.minItems }, (_x, i) => ({ reason: "fixture", scores: { hook: 5 - i, specific: 3, plain: 3, spanish: 3, no_filler: 3 } })) }
      : tool.name === "direct_art" ? (opts.art ?? ((n: number) => art(HOURS[n]!)))(asked.direct_art++)
      : tool.name === "judge_finished_ad" ? (opts.finished ?? (() => finished(16)))(asked.judge_finished_ad++)
      : (opts.visual ?? ((_n: number, checks: readonly string[]) => passAll(checks)))(asked.report_checks++, Object.keys(tool.input_schema.properties.checks!.properties));
    return { id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: tool.name, input }], usage: { input_tokens: 100, output_tokens: 50 } };
  });
  const render = vi.fn(async (i: RenderInput): Promise<RenderOutcome> => opts.render?.(i) ?? { kind: "stored", generationId: `r-${i.picture ?? 1}-${i.attempt}`, assets: [RENDERED], replayed: false });
  const deps = {
    admin: rec.client, client: { messages: { create } } as unknown as MessagesClient, now: () => NOW,
    render, renderModel: "fixture/model",
    motion: { videoModel: "fixture/video", readClip: vi.fn(), storeClip: vi.fn() },
    readAsset: vi.fn(async (_org: string, ref: { sha256: string }) => (ref.sha256 === RENDERED.sha256 ? jpg("clean-highway") : jpg("reference"))),
    storeAsset: vi.fn(async (_org: string, bytes: Buffer): Promise<AdAssetRef> => {
      const m = await sharp(bytes).metadata();
      return { sha256: sha(bytes), format: "png", source_format: "png", width: m.width!, height: m.height!, byte_size: bytes.length };
    }),
  };
  const creative: CreativeRow = { id: "cr-1", org_id: ORG, campaign_id: "c-1", state: "generating", regenerations: 0 };
  const run = (over: Partial<ComposeInput> = {}) => composeCreative(deps, { creative, brief: copyFx.input.brief, recipe: RECIPE, kit: KIT, maxRegenerations: 1, pictures: 3, ...over });
  const keys = (prefix: string) => rec.writtenRows("ad_generations").map((r) => String((r as { idempotency_key: string }).idempotency_key)).filter((k) => k.startsWith(prefix));
  /** What the last write of the creative holds; every `checks` written is the shape the review grid reads. */
  const written = () => {
    const writes = rec.forTable("ads_creatives").filter((q) => q.write?.method === "update").map((q) => q.write!.payload as Record<string, unknown>);
    for (const w of writes) if (w.checks) expect(adCreativeChecksSchema.safeParse(w.checks).error).toBeUndefined();
    return writes.at(-1)!;
  };
  return { rec, deps, render, create, asked, sent, run, keys, written };
}

describe("composeCreative — an ad chosen from several pictures (V3, Q-APX7)", () => {
  it("makes three pictures, each told the ones before it, pairs each with every set of words that fits, and the best-scored pairing becomes the ad", async () => {
    // Nine pairings in the order asked: picture 1 × words 0,1,2, then picture 2, then picture 3. Picture 2 under the
    // second-ranked words is two points clear of everything else.
    const totals = [16, 16, 15, 16, 19, 15, 16, 16, 14];
    const h = harness({ finished: (n) => finished(totals[n] ?? 17) });
    expect(await h.run()).toEqual({ kind: "ready" });

    // Three directions under three keys — the first one's is the key every creative had before V3 — and three renders.
    expect(h.keys("art:")).toEqual(["art:cr-1:1", "art:cr-1:p2:1", "art:cr-1:p3:1"]);
    expect(h.render.mock.calls.map((c) => c[0].picture ?? 1)).toEqual([1, 2, 3]);
    expect(h.keys("visual:")).toEqual(["visual:cr-1:4:5:1", "visual:cr-1:1:1:1", "visual:cr-1:p2:4:5:1", "visual:cr-1:p2:1:1:1", "visual:cr-1:p3:4:5:1", "visual:cr-1:p3:1:1:1"]);
    const told = h.sent.filter((s) => s.tool === "direct_art").map((s) => (JSON.parse(s.body) as { earlier_pictures: Array<{ slots: { time_of_day: string } }> }).earlier_pictures.map((e) => e.slots.time_of_day));
    expect(told).toEqual([[], [HOURS[0]], [HOURS[0], HOURS[1]]]);

    // Nine pairings judged in the frame the picture was composed for, then the winner alone in the other format.
    // Each is keyed by its picture and by its words' place in the WRITER's order, which no ranking moves.
    expect(WORDS).toBe(3);
    const w = h.written();
    const offeredAs = adCandidatesSchema.parse(w.candidates).ranked.map((r) => r.offered_as);
    expect([...offeredAs].sort()).toEqual([0, 1, 2]);
    expect(h.keys("finished:")).toEqual([
      ...[1, 2, 3].flatMap((p) => offeredAs.map((o) => `finished:cr-1:p${p}:w${o}:4:5:1`)),
      `finished:cr-1:p2:w${offeredAs[1]}:1:1:1`,
    ]);

    const pairings = adPairingsSchema.parse(w.pairings);
    expect(pairings.format).toBe("4:5");
    expect(pairings.judge).toBe("finishedAdJudge@1");
    expect(pairings.chosen).toBe(0);
    expect(pairings.ranked).toHaveLength(9);
    expect(pairings.ranked[0]).toMatchObject({ picture: 2, words: 1, total: 19 });
    expect(pairings.pictures.map((p) => [p.picture, p.attempt, p.dropped])).toEqual([[1, 1, null], [2, 1, null], [3, 1, null]]);
    // The ad is the winning pairing: its words are the copy, the ranked set says which, and its images are the assets.
    const candidates = adCandidatesSchema.parse(w.candidates);
    expect(candidates.chosen).toBe(1);
    expect(w.copy).toEqual(candidates.ranked[1]!.copy);
    expect(w.state).toBe("ready");
    const assets = w.assets as Array<{ format: string; language: string; sha256: string }>;
    expect(assets.map((a) => `${a.format} ${a.language}`).sort()).toEqual(["1:1 en", "1:1 es", "4:5 en", "4:5 es"]);
    // Every pairing keeps the one image the judge saw; the winner's is its own 4:5 English ad.
    expect(pairings.ranked.every((r) => r.preview !== null)).toBe(true);
    expect(pairings.ranked[0]!.preview!.sha256).toBe(assets.find((a) => a.format === "4:5" && a.language === "en")!.sha256);
    // The finished ad's opinion is the winner's, in every format it is shown in.
    expect(Object.keys((w.checks as { finished_ad: { by_format: object } }).finished_ad.by_format).sort()).toEqual(["1:1", "4:5"]);
    expectOrgScoped(h.rec, ORG);
  });

  it("one point is not a difference: a pairing one point ahead does not displace the best-ranked words on the first picture", async () => {
    const totals = [17, 16, 16, 16, 16, 18, 16, 16, 16];
    const h = harness({ finished: (n) => finished(totals[n] ?? 17) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const pairings = adPairingsSchema.parse(h.written().pairings);
    // 18 and 17 are "as good": the craft judge's first words lead, and the 18 follows them.
    expect(pairings.ranked.slice(0, 2).map((r) => [r.picture, r.words, r.total])).toEqual([[1, 0, 17], [2, 2, 18]]);
    expect(adCandidatesSchema.parse(h.written().candidates).chosen).toBe(0);
  });

  it("every picture is directed and its render queued before the step waits, so three renders wait together", async () => {
    const h = harness({ render: () => ({ kind: "pending", generationId: "", retryAfterSeconds: null, why: "render job queued" }) });
    expect(await h.run()).toEqual({ kind: "pending", why: "render 1: render job queued" });
    expect(h.asked.direct_art).toBe(3);
    expect(h.render).toHaveBeenCalledTimes(3);
    expect(h.asked.report_checks + h.asked.judge_finished_ad).toBe(0);
    expect(h.written()).not.toHaveProperty("pairings");
  });

  it("a picture that fails its check after its regeneration is dropped with the reason, and the ad is chosen from the others", async () => {
    // Visual checks in the order asked: picture 1 (two formats), picture 2 attempt 1 (two), attempt 2 (two), picture 3.
    const h = harness({ visual: (n, checks) => (n === 2 || n === 4 ? failLettering(checks) : passAll(checks)) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const pairings = adPairingsSchema.parse(h.written().pairings);
    expect(pairings.pictures.map((p) => [p.picture, p.attempt, p.dropped === null])).toEqual([[1, 1, true], [2, 2, false], [3, 1, true]]);
    expect(pairings.pictures[1]!.dropped).toMatch(/^visual check failed after 2 attempt\(s\): 4:5 no_glyphs: Lettering on the trailer side\./);
    expect(pairings.ranked).toHaveLength(6);
    expect(pairings.ranked.some((r) => r.picture === 2)).toBe(false);
    // The dropped picture was regenerated under its own keys, and the third picture was still told about it.
    expect(h.keys("art:")).toEqual(["art:cr-1:1", "art:cr-1:p2:1", "art:cr-1:p2:2", "art:cr-1:p3:1"]);
    // What it was told is each earlier picture's FIRST direction, not its regeneration's: what an earlier picture
    // "was" must not change between two runs of the step.
    const told = (JSON.parse(h.sent.filter((s) => s.tool === "direct_art").at(-1)!.body) as { earlier_pictures: Array<{ slots: { time_of_day: string } }> }).earlier_pictures;
    expect(told.map((e) => e.slots.time_of_day)).toEqual([HOURS[0], HOURS[1]]);
  });

  it("the ad's checks are the winning picture's own: its regeneration, its results, and the attempt its judgement is keyed by", async () => {
    // Picture 2 fails on its first try and passes on its second, then wins under the best-ranked words.
    const h = harness({ visual: (n, checks) => (n === 2 ? failLettering(checks) : passAll(checks)), finished: (n) => finished(n === 3 ? 20 : 15) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const w = h.written();
    expect(adPairingsSchema.parse(w.pairings).ranked[0]).toMatchObject({ picture: 2, words: 0, total: 20 });
    expect(w.regenerations).toBe(1);
    const checks = w.checks as { visual: { attempt: number }; visual_attempts: Array<{ attempt: number; visual: Record<string, Array<{ verdict: string }>> }> };
    expect(checks.visual.attempt).toBe(2);
    expect(checks.visual_attempts.map((a) => a.attempt)).toEqual([1, 2]);
    expect(checks.visual_attempts[0]!.visual["4:5"]!.some((r) => r.verdict === "fail")).toBe(true);
    expect(h.keys("finished:cr-1:p2:").every((k) => k.endsWith(":2"))).toBe(true);
    expect(h.keys("finished:cr-1:p1:").every((k) => k.endsWith(":1"))).toBe(true);
  });

  it("one answer the judge's schema refuses leaves that pairing unjudged and last; the other eight are still asked and ranked", async () => {
    const h = harness({ finished: (n) => (n === 1 ? { scores: "not scores" } : finished(n === 0 ? 14 : 16)) });
    expect(await h.run()).toEqual({ kind: "ready" });
    // Nine pairings asked, then the winner in its other format.
    expect(h.asked.judge_finished_ad).toBe(10);
    const pairings = adPairingsSchema.parse(h.written().pairings);
    expect(pairings.ranked.filter((r) => r.judged === null).map((r) => [r.picture, r.words])).toEqual([[1, 1]]);
    expect(pairings.ranked.at(-1)).toMatchObject({ picture: 1, words: 1, total: null });
    expect(pairings.judge).toBe("finishedAdJudge@1");
    expect((h.written().checks as { finished_ad: { ran: boolean } }).finished_ad.ran).toBe(true);
  });

  it("a direction that repeats an earlier picture drops that picture alone, by name", async () => {
    const h = harness({ art: (n) => art(HOURS[n === 1 ? 0 : n]!) });
    expect(await h.run()).toEqual({ kind: "ready" });
    const pairings = adPairingsSchema.parse(h.written().pairings);
    expect(pairings.pictures.map((p) => p.dropped)).toEqual([null, "art check: repeats_earlier_picture", null]);
    // Its direction was refused, so nothing is known of it — and it was never rendered.
    expect(pairings.pictures[1]).toMatchObject({ reference: null, focal_subject: null, camera_distance: null });
    expect(h.render.mock.calls.map((c) => c[0].picture ?? 1)).toEqual([1, 3]);
    expect(pairings.ranked).toHaveLength(6);
  });

  it("when no picture can be used the creative stops, naming each picture's reason — or the one reason they share, once", async () => {
    // Picture 1 fails its check; picture 2's direction repeats picture 1's: two reasons, each named with its picture.
    const each = harness({ visual: (n, checks) => (n === 0 ? failLettering(checks) : passAll(checks)), art: () => art(HOURS[0]!) });
    const out = await each.run({ maxRegenerations: 0, pictures: 2 });
    expect(out.kind === "check_failed" && out.reason).toBe("none of the 2 pictures could be used — #1 (visual check failed after 1 attempt(s): 4:5 no_glyphs: Lettering on the trailer side.) · #2 (art check: repeats_earlier_picture)");
    expect(each.written()).toMatchObject({ state: "check_failed", last_error: out.kind === "check_failed" ? out.reason : "" });
    expect(each.written()).not.toHaveProperty("pairings");

    // Both fail the same check in the same words: said once, as it was when a creative had one picture.
    const same = harness({ visual: (n, checks) => (n % 2 === 0 ? failLettering(checks) : passAll(checks)) });
    expect(await same.run({ maxRegenerations: 0, pictures: 2 })).toEqual({ kind: "check_failed", reason: "visual check failed after 1 attempt(s): 4:5 no_glyphs: Lettering on the trailer side." });

    const off = harness({ agents: { ...AGENTS, art_director: false } });
    expect(await off.run()).toEqual({ kind: "check_failed", reason: "art: agent_off" });
    expect(off.render).not.toHaveBeenCalled();
  });

  it("words the overlay cannot draw on a picture are left out of that picture's pairings and say why; a picture that can carry none is dropped", async () => {
    const first = (copyFx.recorded.output as { candidates: Array<{ en: { hook: string } }> }).candidates[0]!.en.hook;
    refuseHeadline.when = (headline) => headline === first;
    const h = harness();
    expect(await h.run()).toEqual({ kind: "ready" });
    const w = h.written();
    const at = adCandidatesSchema.parse(w.candidates).ranked.findIndex((r) => r.offered_as === 0);
    const pairings = adPairingsSchema.parse(w.pairings);
    expect(pairings.pictures.map((p) => p.undrawable)).toEqual([1, 2, 3].map(() => [{ words: at, reason: "4:5, en: low_contrast" }]));
    expect(pairings.ranked).toHaveLength(6);
    expect(pairings.ranked.some((r) => r.words === at)).toBe(false);
    expect(pairings.pictures.every((p) => p.dropped === null)).toBe(true);

    refuseHeadline.when = () => true;
    const none = harness();
    expect(await none.run()).toEqual({ kind: "check_failed", reason: "render check (4:5, en): low_contrast" });
    // No visual check is asked of a picture nothing can be drawn on.
    expect(none.asked.report_checks).toBe(0);
    expect((none.written().checks as { render: unknown }).render).toMatchObject({ ok: false, format: "4:5", language: "en" });
  });

  it("with the finished-ad judge switched off the ad is still made: nothing is ranked, and it is the first picture under the best-ranked words", async () => {
    const h = harness({ agents: { ...AGENTS, finished_ad_judge: false } });
    expect(await h.run()).toEqual({ kind: "ready" });
    expect(h.asked.judge_finished_ad).toBe(0);
    const w = h.written();
    const pairings: AdPairings = adPairingsSchema.parse(w.pairings);
    expect(pairings.judge).toBeNull();
    expect(pairings.ranked[0]).toMatchObject({ picture: 1, words: 0, judged: null, total: null });
    expect(pairings.ranked).toHaveLength(9);
    expect((w.checks as { finished_ad: unknown }).finished_ad).toMatchObject({ ran: false, not_run: "agent_off" });
    expect(h.keys("finished:")).toHaveLength(0);
    // A switch that is off is asked about once, not once per pairing: every call through the rail reads the
    // settings in force, so against the same ad with the judge on — nine pairings and the winner's other format,
    // ten calls — this one makes nine fewer.
    const on = harness();
    await on.run();
    const reads = (x: ReturnType<typeof harness>) => x.rec.forTable("ads_settings_versions").length;
    expect(reads(on) - reads(h)).toBe(9);
  });

  it("a person's words are drawn on the picture they kept: that picture's direction and render are asked for by the replaced creative's own keys", async () => {
    const h = harness();
    const copy = (copyFx.recorded.output as { candidates: Array<{ en: Record<string, string>; es: Record<string, string> }> }).candidates[0]!;
    const choice = { copy, from_candidate: null, edited_slots: [], chosen_by_name: "Koni", replaced: { creativeId: "old-1", attempt: 2, picture: 3, candidates: null } };
    expect(await h.run({ choice })).toEqual({ kind: "ready" });
    // One picture, the third of the creative it replaces at its second attempt — replayed there, not made again here.
    expect(h.keys("art:")).toEqual(["art:old-1:p3:2"]);
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.render.mock.calls[0]![0]).toMatchObject({ creativeId: "old-1", picture: 3, attempt: 2 });
    // The check and the opinion are this creative's own: the words on the picture are new.
    expect(h.keys("visual:")).toEqual(["visual:cr-1:4:5:1", "visual:cr-1:1:1:1"]);
    expect(h.written()).not.toHaveProperty("pairings");
    expect(h.written().copy).toEqual(copy);
  });

  it("one picture is the ad as it was made before V3: the first words that fit, the old keys, and no pairings written", async () => {
    const h = harness();
    expect(await h.run({ pictures: 1 })).toEqual({ kind: "ready" });
    expect(h.keys("art:")).toEqual(["art:cr-1:1"]);
    expect(h.keys("finished:")).toEqual(["finished:cr-1:4:5:1", "finished:cr-1:1:1:1"]);
    expect(h.render).toHaveBeenCalledTimes(1);
    expect(h.render.mock.calls[0]![0]).not.toHaveProperty("picture");
    expect(h.written()).not.toHaveProperty("pairings");
    expect(adCandidatesSchema.parse(h.written().candidates).chosen).toBe(0);
  });
});

describe("how many pictures a creative is chosen from", () => {
  it("is the setting, held between one and five; one when unset; and one for a person's choice, which keeps its picture", () => {
    expect([undefined, 0, 1, 3, 5, 9, 2.7].map((pictures) => pictureCount({ pictures }))).toEqual([1, 1, 1, 3, 5, 5, 2]);
    expect(pictureCount({ pictures: 3, choice: {} as ComposeInput["choice"] })).toBe(1);
  });
});

describe("composeCreative — a plan angle that is a motion ad (V4)", () => {
  const CLIP = { sha256: "c".repeat(64), format: "mp4" as const, width: 1080, height: 1350, duration_ms: 5000, has_audio: false, byte_size: 9 };
  const MOTION = { format: "4:5", model: "fixture/video", clip: CLIP, frames_checked: 11, files: [{ ...CLIP, has_audio: true, duration_ms: 7000, language: "en", path: `${ORG}/${"c".repeat(64)}.mp4` }] };
  const made = { kind: "made", motion: MOTION, checks: { ok: true, frames: 11 } };

  it("an angle that is not a motion ad never asks for one, and writes no motion", async () => {
    motion.answer = made;
    for (const pictures of [1, 3]) {
      const h = harness();
      expect(await h.run({ pictures })).toEqual({ kind: "ready" });
      expect(h.written()).not.toHaveProperty("motion");
      expect((h.written().checks as object)).not.toHaveProperty("motion");
    }
    expect(motion.calls).toEqual([]);
  });

  it("one picture: the finished still's own picture, attempt and words are set moving, and the motion ad is written with the still", async () => {
    motion.answer = made;
    const h = harness();
    expect(await h.run({ pictures: 1, motion: true })).toEqual({ kind: "ready" });
    const w = h.written();
    expect(motion.calls).toHaveLength(1);
    expect(motion.calls[0]!.input).toMatchObject({ ids: { orgId: ORG, campaignId: "c-1", creativeId: "cr-1" }, picture: 1, attempt: 1, base: { sha256: RENDERED.sha256, format: "jpeg" }, copy: w.copy, recipe: RECIPE, kit: KIT });
    // The clip goes down the still's own render road, with the still's own readers.
    expect(motion.calls[0]!.deps).toMatchObject({ videoModel: "fixture/video", render: h.deps.render, readAsset: h.deps.readAsset });
    expect(w).toMatchObject({ state: "ready", motion: MOTION });
    expect(w.checks).toMatchObject({ visual: { ok: true }, motion: { ok: true, frames: 11 } });
    expect((w.assets as unknown[]).length).toBe(4); // the still is whole beside it
  });

  it("several pictures: what moves is the WINNING pairing's picture under its words, not the first made", async () => {
    motion.answer = made;
    const totals = [16, 16, 15, 16, 19, 15, 16, 16, 14]; // picture 2 under the second-ranked words wins
    const h = harness({ finished: (n) => finished(totals[n] ?? 17) });
    expect(await h.run({ motion: true })).toEqual({ kind: "ready" });
    const w = h.written();
    expect(motion.calls).toHaveLength(1);
    expect(motion.calls[0]!.input).toMatchObject({ picture: 2, attempt: 1, copy: w.copy });
    expect(adPairingsSchema.parse(w.pairings).ranked[0]).toMatchObject({ picture: 2 });
    expect(w).toMatchObject({ state: "ready", motion: MOTION });
  });

  it("a clip still being made keeps the creative with the workers: pending, and nothing is finished", async () => {
    motion.answer = { kind: "pending", why: "motion clip: queued" };
    const h = harness();
    expect(await h.run({ pictures: 1, motion: true })).toEqual({ kind: "pending", why: "motion clip: queued" });
    const states = (x: typeof h) => x.rec.forTable("ads_creatives").filter((q) => q.write?.method === "update").map((q) => (q.write!.payload as { state?: string }).state);
    expect(states(h)).not.toContain("ready");
    expect(states(h)).not.toContain("check_failed");
    // The same with several pictures, which finish on another branch.
    const several = harness();
    expect(await several.run({ pictures: 3, motion: true })).toEqual({ kind: "pending", why: "motion clip: queued" });
    expect(states(several)).not.toContain("ready");
  });

  it("a motion ad that cannot be made does not take the still with it: the creative is ready, with the reason beside it and no motion", async () => {
    motion.answer = { kind: "stop", reason: "motion clip: 3.0 s came back for the 5 s asked" };
    const h = harness();
    expect(await h.run({ pictures: 1, motion: true })).toEqual({ kind: "ready" });
    const w = h.written();
    expect(w).toMatchObject({ state: "ready", last_error: null });
    expect(w).not.toHaveProperty("motion");
    expect((w.checks as { motion: unknown }).motion).toEqual({ ok: false, reason: "motion clip: 3.0 s came back for the 5 s asked" });
    // A stop that carries the frame check's findings keeps them.
    motion.answer = { kind: "stop", reason: "motion check (en): …", checks: { ok: false, language: "en", findings: [{ label: "headline" }] } };
    const h2 = harness();
    await h2.run({ motion: true });
    expect((h2.written().checks as { motion: unknown }).motion).toEqual({ ok: false, language: "en", findings: [{ label: "headline" }], reason: "motion check (en): …" });
  });

  it("a motion record the review screen could not read is a failure here, not a blank screen there", async () => {
    motion.answer = { ...made, motion: { ...MOTION, files: [] } };
    await expect(harness().run({ pictures: 1, motion: true })).rejects.toThrow();
  });

  it("a person's choice keeps its picture and is not set moving again; nor is anything where the worker has no motion parts", async () => {
    motion.answer = made;
    const copy = (copyFx.recorded.output as { candidates: Array<ComposeInput["choice"] extends infer C ? C extends { copy: infer K } ? K : never : never> }).candidates[0]!;
    const h = harness();
    expect(await h.run({ motion: true, choice: { copy, from_candidate: null, edited_slots: [], chosen_by_name: "Ana", replaced: { creativeId: "cr-0", attempt: 1, candidates: null } } })).toEqual({ kind: "ready" });
    const bare = harness();
    delete (bare.deps as { motion?: unknown }).motion;
    expect(await bare.run({ pictures: 1, motion: true })).toEqual({ kind: "ready" });
    expect(motion.calls).toEqual([]);
    expect(bare.written()).not.toHaveProperty("motion");
  });
});
