import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, NO_LETTERING, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { ART_DIRECTOR_EVAL, loadFixtures } from "../agentFixtures.js";
import { ART_DIRECTOR_PROMPT_VERSION, directArt } from "./artDirector.js";

/**
 * The Art director's replay (workflow C2; §4R "CI replays recorded model outputs"), on the Copywriter's
 * pattern: every fixture's recorded answer through `directArt` and the real A4 rail, with a client that
 * answers the recording. Pinned cases are named literally so `lint:ads-readiness` can see them.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-03T18:00:00Z");
const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { art_director: true } },
};
const world = () => createSupabaseRecorder({
  tables: {
    ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
    ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : []),
  },
});
function answering(output: unknown) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "direct_art", input: output }],
    usage: { input_tokens: 700, output_tokens: 120 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const fixtures = loadFixtures(ART_DIRECTOR_EVAL);
const byName = (name: string) => {
  const fx = fixtures.find((f) => f.fixture.name === name)?.fixture;
  if (!fx) throw new Error(`no fixture named ${name}`);
  return fx;
};
const run = (fx: ReturnType<typeof byName>, rec = world(), output: unknown = fx.recorded.output, over: Partial<typeof fx.input> = {}) => {
  const { client, create } = answering(output);
  const out = directArt({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, campaignId: "c-1", creativeId: "cr-1", attempt: 1, ...fx.input, ...over });
  return { out, create, rec };
};

async function replay(name: string): Promise<void> {
  const fx = byName(name);
  const { out: pending, create, rec } = run(fx);
  const out = await pending;
  expect(create).toHaveBeenCalledTimes(1);
  if (fx.expect === "ready") {
    expect(out.kind).toBe("ready");
    if (out.kind === "ready") expect(out.direction.prompt.endsWith(NO_LETTERING)).toBe(true);
  } else if (fx.expect === "off_schema") expect(out).toMatchObject({ kind: "failed", errorCode: "off_schema" });
  else {
    expect(out.kind).toBe("refused");
    expect(out.kind === "refused" ? [...new Set(out.findings.map((f) => f.kind))].sort() : []).toEqual(fx.expect_findings);
  }
  expectOrgScoped(rec, ORG);
}

const PINNED = new Set(["planted-digit-in-slot", "planted-lettering", "planted-foreign-photo", "planted-photo-on-text-only", "planted-quote-in-slot", "instruction-in-label"]);

describe("art director replay — every recorded answer reaches its fixture's verdict", () => {
  it("has model recordings under the prompt in force and planted defects beside them", () => {
    expect(fixtures.filter((f) => f.fixture.recorded.source === "model").length).toBeGreaterThanOrEqual(10);
    expect(fixtures.filter((f) => f.fixture.recorded.source === "planted").length).toBeGreaterThanOrEqual(4);
    for (const { fixture } of fixtures) expect(fixture.recorded.prompt_version, fixture.name).toBe(ART_DIRECTOR_PROMPT_VERSION);
  });
  it("planted-digit-in-slot", () => replay("planted-digit-in-slot"));
  it("planted-lettering", () => replay("planted-lettering"));
  it("planted-foreign-photo", () => replay("planted-foreign-photo"));
  it("planted-photo-on-text-only", () => replay("planted-photo-on-text-only"));
  it("planted-quote-in-slot", () => replay("planted-quote-in-slot"));
  it("instruction-in-label", () => replay("instruction-in-label"));
  it.each(fixtures.map((f) => f.fixture.name).filter((n) => !PINNED.has(n)))("%s", (name) => replay(name));
});

describe("art director — what it refuses without asking, and what it sends", () => {
  const fx = byName("tractor-on-highway");

  it("refuses a scene with equipment when the brand kit has no photos, asking no model", async () => {
    const { out, create } = run(fx, world(), fx.recorded.output, { kit: { ...fx.input.kit, equipment_photos: [] } });
    expect(await out).toEqual({ kind: "not_possible", reason: "no_reference_photo" });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a preset showing people while the people policy is none, asking no model", async () => {
    const { out, create } = run(fx, world(), fx.recorded.output, { recipe: { ...fx.input.recipe, shows_people: true }, kit: { ...fx.input.kit, people_policy: "none" } });
    expect(await out).toEqual({ kind: "not_possible", reason: "people_policy_none" });
    expect(create).not.toHaveBeenCalled();
  });

  it("hands on a prompt ending with the no-lettering clause and the kit photo it starts from", async () => {
    const { out } = run(fx);
    const o = await out;
    expect(o.kind === "ready" && o.direction.prompt).toMatch(new RegExp(`, ${NO_LETTERING}$`));
    expect(o.kind === "ready" && o.direction.reference?.sha256).toBe((fx.recorded.output as { reference_photo: string }).reference_photo);
  });

  it("asks once per creative and attempt, as the art director, sending the job as context but no claims and no company name", async () => {
    const { out, create, rec } = run(fx);
    await out;
    expect(rec.writtenRows("ad_generations")[0]).toMatchObject({ agent: "art_director", idempotency_key: "art:cr-1:1", prompt_version: ART_DIRECTOR_PROMPT_VERSION });
    const sent = (create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(Object.keys(JSON.parse(sent) as object).sort()).toEqual(["context", "photos", "scene", "slots", "template"]);
    expect(sent).not.toContain("Fixture Carrier");
  });
});
