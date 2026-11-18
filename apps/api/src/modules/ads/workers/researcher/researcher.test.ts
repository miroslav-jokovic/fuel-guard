import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { loadFixtures } from "../agentFixtures.js";
import { RESEARCHER_PROMPT_VERSION, buildReadRequest, readKey, readPage, readingSheet } from "./researcher.js";
import { RESEARCHER_EVAL } from "./researcherEval.js";

/**
 * The Researcher's CI replay (ADS-PLATFORM-V2-PLAN V2r; workflow §4R): every fixture's RECORDED reading goes
 * through the real worker and the real rail, with a client that answers the recording, and must reach the
 * fixture's verdict. The planted readings prove `checkPageReading` drops each defect by name at this worker.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ENTRY = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-18T18:20:00Z");
const settings: AdsSettings = {
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { researcher: true } },
};

function world(generations: unknown[] = []) {
  return createSupabaseRecorder({
    tables: {
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings, kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : generations),
    },
  });
}

function answering(output: unknown) {
  const create = vi.fn(async (_body: unknown) => ({
    id: "msg_1", stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t1", name: "write_items", input: output }],
    usage: { input_tokens: 3000, output_tokens: 700 },
  }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

const fixtures = loadFixtures(RESEARCHER_EVAL);
const fixture = (name: string) => {
  const fx = fixtures.find((f) => f.fixture.name === name)?.fixture;
  if (!fx) throw new Error(`no fixture named ${name}`);
  return fx;
};

async function replay(name: string) {
  const fx = fixture(name);
  const rec = world();
  const { client, create } = answering(fx.recorded.output);
  const out = await readPage({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, entryId: ENTRY, attempt: 1, url: fx.input.url, text: fx.input.page_text });
  expect(create).toHaveBeenCalledTimes(1);
  expectOrgScoped(rec, ORG);
  const judged = RESEARCHER_EVAL.judge(fx, fx.recorded.output);
  expect(judged.verdict, name).toBe(fx.expect);
  if (fx.expect === "off_schema") return expect(out).toMatchObject({ kind: "failed", errorCode: "off_schema" });
  if (out.kind !== "read") throw new Error(`${name}: ${out.kind}`);
  expect(out.kept.length + out.dropped.length).toBe((fx.recorded.output as { items: unknown[] }).items.length);
  expect([...new Set(out.dropped.map((d) => d.reason))].sort(), name).toEqual(fx.recorded.source === "planted" ? fx.expect_findings ?? [] : []);
}

describe("researcher replay — every recorded reading reaches its fixture's verdict", () => {
  it("has model recordings under the prompt in force and planted defects beside them", () => {
    expect(fixtures.filter((f) => f.fixture.recorded.source === "model").length).toBeGreaterThanOrEqual(9);
    expect(fixtures.filter((f) => f.fixture.recorded.source === "planted").length).toBeGreaterThanOrEqual(4);
    for (const { fixture: fx } of fixtures) expect(fx.recorded.prompt_version, fx.name).toBe(RESEARCHER_PROMPT_VERSION);
  });

  it("the live eval met the bar: every model recording agrees with its truth, and the baseline says so", () => {
    const models = fixtures.filter((f) => f.fixture.recorded.source === "model").map((f) => f.fixture);
    const misses = models.filter((fx) => { const j = RESEARCHER_EVAL.judge(fx, fx.recorded.output); return !RESEARCHER_EVAL.agrees!(fx, j.verdict, j.findings); });
    expect(misses.map((m) => m.name)).toEqual([]);
    const baseline = JSON.parse(readFileSync(new URL("./baseline.json", import.meta.url), "utf8"));
    expect(baseline).toMatchObject({ prompt_version: RESEARCHER_PROMPT_VERSION, asked: models.length, agreed: models.length, agreement: 1 });
  });

  it.each(fixtures.map((f) => f.fixture.name))("%s", (name) => replay(name));

  // The cases the readiness level pins, named here literally so `lint:ads-readiness` can see them.
  it("planted-quote-not-on-page", () => replay("planted-quote-not-on-page"));
  it("planted-figure-not-in-quote", () => replay("planted-figure-not-in-quote"));
  it("planted-one-of-two-dropped", () => replay("planted-one-of-two-dropped"));
  it("instruction-in-page", () => replay("instruction-in-page"));
  it("not-found", () => replay("not-found"));
});

describe("the Researcher's request", () => {
  it("hands the page as one field of a JSON sheet, with the topics, and keys the call by entry and attempt", () => {
    const req = buildReadRequest("https://a.example/job", "Some page text.");
    expect(JSON.parse(req.user as string)).toEqual(readingSheet("https://a.example/job", "Some page text."));
    expect(req.tool.name).toBe("write_items");
    expect(readKey(ENTRY, 2)).toBe(`swipe:${ENTRY}:2`);
  });

  it("checks a replayed answer against the text stored with its request, not the text handed in now", async () => {
    const fx = fixture("planted-figure-not-in-quote");
    // The stored request's page holds the planted figure; the page handed in now does not.
    const stored = { ...buildReadRequest(fx.input.url, `${fx.input.page_text}\nHome every 7 days.`), user: JSON.stringify(readingSheet(fx.input.url, `${fx.input.page_text}\nHome every 7 days.`)) };
    const quote = { items: [{ topic: "home_time", sentence: "Drivers are home every 7 days.", quote: "Home every 7 days." }] };
    const rec = world([{ id: "gen-1", status: "succeeded", output: quote, request: { user: stored.user }, error_code: null, started_at: NOW.toISOString() }]);
    const { client, create } = answering(quote);
    const out = await readPage({ admin: rec.client, client, now: () => NOW }, { orgId: ORG, entryId: ENTRY, attempt: 1, url: fx.input.url, text: fx.input.page_text });
    expect(create).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "read", replayed: true, dropped: [] });
  });
});
