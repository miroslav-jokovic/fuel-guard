import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { AD_VISUAL_CHECKS, ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { CHECKER_EVAL, checkerSubject, loadFixtures, type CheckerFixture } from "../agentFixtures.js";
import { CHECKER_PROMPT_VERSION, VISION_LONG_EDGE, checkVisual, cutBand, fitForVision, judgeVisual, type VisualSubject } from "./checker.js";

/**
 * The Checker's replay (workflow C5a; §4R "CI replays recorded model outputs"), on the Copywriter's and Art
 * director's pattern: every fixture's recorded answer goes through `checkVisual` and the real A4 rail, with a
 * client that answers the recording. The planted-defect images are real (`fixtures/images/`); pinned cases
 * are named literally so `lint:ads-readiness` can see them.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-04T18:00:00Z");
const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { checker: true } },
};
const world = () => createSupabaseRecorder({
  tables: {
    ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
    ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : []),
  },
});

function answering(output: unknown) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "report_checks", input: output }],
    usage: { input_tokens: 2_400, output_tokens: 400 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const fixtures = loadFixtures(CHECKER_EVAL);
const byName = (name: string) => fixtures.find((f) => f.fixture.name === name)!.fixture;

async function run(fx: CheckerFixture, subject: VisualSubject = checkerSubject(fx), output: unknown = fx.recorded.output) {
  const rec = world();
  const { client, create } = answering(output);
  const out = await checkVisual({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, campaignId: "c-1", creativeId: "cr-1", format: "4:5", attempt: 1, subject });
  return { out, create, rec };
}

async function replay(name: string) {
  const fx = byName(name);
  const { out, create, rec } = await run(fx);
  expect(create).toHaveBeenCalledTimes(1);
  if (fx.expect === "ready") expect(out.kind).toBe("passed");
  if (fx.expect === "off_schema") expect(out).toMatchObject({ kind: "failed", errorCode: "off_schema" });
  if (fx.expect === "refused") {
    expect(out.kind).toBe("check_failed");
    const failing = out.kind === "check_failed" ? out.results.filter((r) => r.verdict === "fail").map((r) => r.check).sort() : [];
    expect(failing).toEqual(fx.expect_findings);
  }
  expectOrgScoped(rec, ORG);
}

const PINNED = new Set(["defect-lettering", "defect-foreign-logo", "defect-wrong-truck", "defect-malformed", "defect-person", "defect-subject-in-band", "clean-highway", "instruction-in-label", "planted-answer-one-fail", "planted-answer-missing-item"]);

describe("checker replay — every recorded answer reaches its fixture's verdict", () => {
  it("has model recordings of every planted defect under the prompt in force", () => {
    const planted = new Set(fixtures.filter((f) => f.fixture.recorded.source === "model").map((f) => f.fixture.truth.planted));
    // One image per checklist item, plus clean ones: the corpus §4R asks for.
    for (const check of AD_VISUAL_CHECKS) expect(planted.has(check), check).toBe(true);
    expect(planted.has(null)).toBe(true);
    for (const { fixture } of fixtures) expect(fixture.recorded.prompt_version, fixture.name).toBe(CHECKER_PROMPT_VERSION);
  });

  it("every model recording refuses the defect its image was made with, and passes the clean ones", () => {
    for (const { fixture: f } of fixtures.filter((x) => x.fixture.recorded.source === "model")) {
      if (f.truth.planted === null) expect(f.expect, f.name).toBe("ready");
      else expect(f.expect_findings ?? [], f.name).toContain(f.truth.planted);
    }
  });

  it("defect-lettering", () => replay("defect-lettering"));
  it("defect-foreign-logo", () => replay("defect-foreign-logo"));
  it("defect-wrong-truck", () => replay("defect-wrong-truck"));
  it("defect-malformed", () => replay("defect-malformed"));
  it("defect-person", () => replay("defect-person"));
  it("defect-subject-in-band", () => replay("defect-subject-in-band"));
  it("clean-highway", () => replay("clean-highway"));
  it("instruction-in-label", () => replay("instruction-in-label"));
  it("planted-answer-one-fail", () => replay("planted-answer-one-fail"));
  it("planted-answer-missing-item", () => replay("planted-answer-missing-item"));
  it.each(fixtures.map((f) => f.fixture.name).filter((n) => !PINNED.has(n)))("%s", (name) => replay(name));
});

describe("checker — what it sends and stores", () => {
  const fx = byName("clean-highway");

  it("refuses a scene with equipment and no reference photo, asking no model", async () => {
    const { out, create } = await run(fx, { ...checkerSubject(fx), reference: null });
    expect(out).toEqual({ kind: "no_reference" });
    expect(create).not.toHaveBeenCalled();
  });

  it("sends the image, the reference and the cut band as base64, and the ledger keeps only their hashes", async () => {
    const { create, rec } = await run(fx);
    const content = (create.mock.calls[0]![0] as { messages: Array<{ content: Array<{ type: string; source?: { data: string } }> }> }).messages[0]!.content;
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(3);
    const subject = checkerSubject(fx);
    expect(images[0]!.source!.data).toBe(Buffer.from(subject.image.bytes).toString("base64"));
    expect(images[1]!.source!.data).toBe(Buffer.from(subject.reference!.image.bytes).toString("base64"));
    const row = rec.writtenRows("ad_generations")[0]!;
    expect(row).toMatchObject({ agent: "checker", idempotency_key: "visual:cr-1:4:5:1", prompt_version: CHECKER_PROMPT_VERSION });
    const sent = JSON.stringify(row.request);
    expect(sent).toContain(createHash("sha256").update(subject.image.bytes).digest("hex"));
    for (const img of images) expect(sent).not.toContain(img.source!.data.slice(0, 200));
  });

  it("asks no equipment item of a text-only scene, and records it not applicable", async () => {
    const empty = byName("clean-empty-road");
    const { out, create } = await run(empty);
    const tool = (create.mock.calls[0]![0] as { tools: Array<{ input_schema: { properties: { checks: { properties: object } } } }> }).tools[0]!;
    expect(Object.keys(tool.input_schema.properties.checks.properties)).not.toContain("equipment_matches_reference");
    expect(out.kind === "passed" && out.results.map((r) => r.check)).toEqual([...AD_VISUAL_CHECKS]);
    expect(out.kind === "passed" && out.results.find((r) => r.check === "equipment_matches_reference")).toEqual({
      check: "equipment_matches_reference", verdict: "not_applicable", reason: "the preset shows no equipment",
    });
  });

  it("people are allowed only when the preset shows them and the kit's policy is varied", async () => {
    const sentData = async (subject: VisualSubject) => {
      const { create } = await run(fx, subject);
      const content = (create.mock.calls[0]![0] as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }).messages[0]!.content;
      return JSON.parse(content.filter((b) => b.type === "text").at(-1)!.text!) as { people_allowed: boolean; forbidden_marks: string[] };
    };
    const base = checkerSubject(fx);
    expect(await sentData(base)).toMatchObject({ people_allowed: false, forbidden_marks: ["ACME Logistics"] });
    expect((await sentData({ ...base, scene: { ...base.scene, shows_people: true } })).people_allowed).toBe(false);
    expect((await sentData({ ...base, kit: { ...base.kit, people_policy: "varied" } })).people_allowed).toBe(false);
    expect((await sentData({ ...base, scene: { ...base.scene, shows_people: true }, kit: { ...base.kit, people_policy: "varied" } })).people_allowed).toBe(true);
  });

  it("ads:eval counts a refusal of the planted defect, and a pass of a clean image, as right", () => {
    const agrees = CHECKER_EVAL.agrees!;
    const lettering = byName("defect-lettering");
    expect(agrees(lettering, "refused", ["no_glyphs", "safe_zone_clear"])).toBe(true);
    expect(agrees(lettering, "refused", ["safe_zone_clear"])).toBe(false);
    expect(agrees(lettering, "ready", [])).toBe(false);
    expect(agrees(fx, "ready", [])).toBe(true);
    expect(agrees(fx, "refused", ["no_glyphs"])).toBe(false);
  });

  it("an asked item the answer lacks is a fail, never a pass", () => {
    const { checks } = fx.recorded.output as { checks: Record<string, unknown> };
    const { no_glyphs: _gone, ...rest } = checks;
    const v = judgeVisual({ checks: rest } as never, fx.input.scene);
    expect(v.ok).toBe(false);
    expect(v.results.find((r) => r.check === "no_glyphs")).toEqual({ check: "no_glyphs", verdict: "fail", reason: "not answered" });
  });
});

describe("checker — the images it prepares", () => {
  // Top half blue, bottom half red: a band over the bottom half must be all red.
  const twoTone = async (width: number, height: number) => {
    const half = await sharp({ create: { width, height: height / 2, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const bytes = await sharp({ create: { width, height, channels: 3, background: "#0000ff" } }).composite([{ input: half, top: height / 2, left: 0 }]).png().toBuffer();
    return { format: "png" as const, bytes: new Uint8Array(bytes) };
  };

  it("the band is cut from exactly the fractions given", async () => {
    const img = await twoTone(400, 400);
    const band = await cutBand(img, { x: 0.1, y: 0.55, width: 0.8, height: 0.4 });
    const { data, info } = await sharp(band.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([320, 160]);
    const reds = Array.from({ length: data.length / 3 }, (_, i) => data[i * 3]! > 200 && data[i * 3 + 2]! < 60);
    expect(reds.every(Boolean)).toBe(true);
    const across = await cutBand(img, { x: 0, y: 0.25, width: 1, height: 0.5 });
    const top = await sharp(across.bytes).extract({ left: 0, top: 0, width: 400, height: 10 }).raw().toBuffer();
    expect(top[2]! > 200 && top[0]! < 60).toBe(true);
  });

  it("an image within the long edge is sent byte for byte; a larger one is shrunk to it", async () => {
    const small = await twoTone(800, 600);
    expect(await fitForVision(small)).toBe(small);
    const big = await fitForVision(await twoTone(3000, 2000));
    const meta = await sharp(big.bytes).metadata();
    expect([big.format, meta.width, meta.height]).toEqual(["jpeg", VISION_LONG_EDGE, Math.round((2000 * VISION_LONG_EDGE) / 3000)]);
  });
});
