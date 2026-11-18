import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings, type PictureReading } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { loadFixtures } from "../agentFixtures.js";
import { SWIPE_READER_PROMPT_VERSION, buildPictureRequest, pictureSheet, readPicture } from "./swipeReader.js";
import { SWIPE_READER_EVAL, fixtureImage, swipeReaderFindings } from "./swipeReaderEval.js";

/**
 * The Swipe reader's CI replay (ADS-PLATFORM-V2-PLAN V2r; workflow §4R): every fixture's RECORDED reading goes
 * through the real worker and the real rail, and the eval's judge over it reaches the fixture's verdict.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENTRY = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-18T18:20:00Z");
const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { swipe_reader: true } },
};

function world() {
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : []),
    },
  });
}

const fixtures = loadFixtures(SWIPE_READER_EVAL);
const fixture = (name: string) => {
  const fx = fixtures.find((f) => f.fixture.name === name)?.fixture;
  if (!fx) throw new Error(`no fixture named ${name}`);
  return fx;
};

async function replay(name: string) {
  const fx = fixture(name);
  const rec = world();
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "describe_ad", input: fx.recorded.output }],
    usage: { input_tokens: 1800, output_tokens: 300 },
  }));
  const out = await readPicture({ admin: rec.client, client: { messages: { create } } as unknown as MessagesClient, now: () => NOW },
    { orgId: ORG, entryId: ENTRY, attempt: 1, image: fixtureImage(fx), note: fx.input.note });
  expect(create).toHaveBeenCalledTimes(1);
  expectOrgScoped(rec, ORG);
  const judged = SWIPE_READER_EVAL.judge(fx, fx.recorded.output);
  expect(judged.verdict, name).toBe(fx.expect);
  expect(out.kind, name).toBe(fx.expect === "ready" ? "read" : "failed");
}

describe("swipe reader replay — every recorded reading reaches its fixture's verdict", () => {
  it("has model recordings under the prompt in force and a planted defect beside them", () => {
    expect(fixtures.filter((f) => f.fixture.recorded.source === "model").length).toBeGreaterThanOrEqual(7);
    expect(fixtures.filter((f) => f.fixture.recorded.source === "planted").length).toBeGreaterThanOrEqual(1);
    for (const { fixture: fx } of fixtures) expect(fx.recorded.prompt_version, fx.name).toBe(SWIPE_READER_PROMPT_VERSION);
  });

  it("the live eval met the bar: every model recording agrees with its truth, and the baseline says so", () => {
    const models = fixtures.filter((f) => f.fixture.recorded.source === "model").map((f) => f.fixture);
    const misses = models.filter((fx) => { const j = SWIPE_READER_EVAL.judge(fx, fx.recorded.output); return !SWIPE_READER_EVAL.agrees!(fx, j.verdict, j.findings); });
    expect(misses.map((m) => `${m.name}: ${SWIPE_READER_EVAL.judge(m, m.recorded.output).findings.join(", ")}`)).toEqual([]);
    const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"));
    expect(baseline).toMatchObject({ prompt_version: SWIPE_READER_PROMPT_VERSION, asked: models.length, agreed: models.length, agreement: 1 });
  });

  it.each(fixtures.map((f) => f.fixture.name))("%s", (name) => replay(name));
  it("planted-off-list-scene", () => replay("planted-off-list-scene"));
  it("photo-no-words", () => replay("photo-no-words"));
});

describe("the eval's judge is not vacuous", () => {
  const fx = fixture("clean-highway-pay");
  const sound: PictureReading = { hook_family: "pay_first", scene_family: "equipment_on_road", words: ["$0.65 PER MILE,", "CLASS A OTR.", "APPLY TODAY", "Equal Opportunity Employer"], summary: "It offers OTR work paid by the mile." };
  it("accepts a reading in capitals split over lines", () => expect(swipeReaderFindings(fx, sound)).toEqual([]));
  it("names an invented figure, a missed phrase and a wrong family", () => {
    expect(swipeReaderFindings(fx, { ...sound, words: ["$0.68 per mile, Class A OTR.", "Apply today"], scene_family: "cab_pov" }))
      .toEqual(["scene:cab_pov", "missing:$0.65 per mile, Class A OTR.", "missing:Equal Opportunity Employer", "invented:0.68"]);
  });
  it("sends the picture first and the sheet as data", async () => {
    const req = await buildPictureRequest(fixtureImage(fx), "seen on Facebook");
    expect(Array.isArray(req.user) && req.user[0]!.type).toBe("image");
    expect(Array.isArray(req.user) && req.user[1]!.type === "text" && JSON.parse(req.user[1]!.text)).toEqual(pictureSheet("seen on Facebook"));
  });
});
