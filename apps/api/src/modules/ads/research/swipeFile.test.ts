import { describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, type AdsSettings } from "@silvicom/shared";
import type { MessagesClient } from "../../../lib/anthropic.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { archiveSwipe, readAgain, readSwipeEntry, swipeEvidence } from "./swipeFile.js";

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const NOW = new Date("2026-11-18T18:00:00Z");
const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];
const PAGE = `<html><body><h1>OTR Driver</h1><p>Earn up to $0.68 per mile, home every weekend.</p><p>${"We hire drivers across the Midwest. ".repeat(8)}</p></body></html>`;

const settings = (on: boolean): AdsSettings => ({
  ...ADS_SETTINGS_UNSET,
  budgets: { ...ADS_SETTINGS_UNSET.budgets, anthropic_tokens_monthly: 1_000_000, agents_enabled: { researcher: on, swipe_reader: on } },
});

const row = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: "page", url: "https://jobs.example.com/otr", asset: null, note: null, state: "waiting", read_attempt: 1, reading: null, dropped: [],
  last_error: null, read_at: null, created_at: NOW.toISOString(), created_by_name: "Koni", archived_at: null, ...over,
});

function world(entry: Record<string, unknown> | null, on = true) {
  return createSupabaseRecorder({
    tables: {
      ads_swipe_entries: (q: RecordedQuery) => (q.write ? [{ id: ID }] : entry ? [entry] : []),
      ads_settings_versions: [{ id: "v1", org_id: ORG, version: 1, settings: settings(on), kill_switch: false, kill_reason: null, created_at: NOW.toISOString(), created_by_name: "X" }],
      ad_generations: (q: RecordedQuery) => (q.write?.method === "insert" ? [{ id: "gen-1" }] : []),
    },
  });
}

function answering(input: unknown) {
  const create = vi.fn(async () => ({ id: "m", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t", name: "write_items", input }], usage: { input_tokens: 1, output_tokens: 1 } }));
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const servePage = (body: string, status = 200) => vi.fn(async () => new Response(body, { status, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

const theUpdate = (rec: ReturnType<typeof world>) => rec.forTable("ads_swipe_entries").find((q) => q.write?.method === "update")!;

describe("readSwipeEntry — a saved page", () => {
  it("fetches the page, reads it, keeps the items the check passes and writes them on the same attempt", async () => {
    const rec = world(row());
    const { client } = answering({ items: [
      { topic: "pay", sentence: "They pay up to $0.68 per mile.", quote: "Earn up to $0.68 per mile, home every weekend." },
      { topic: "pay", sentence: "They pay $0.70 per mile.", quote: "Earn up to $0.68 per mile" },
    ] });
    const out = await readSwipeEntry({ admin: rec.client, client, now: () => NOW, page: { fetch: servePage(PAGE), lookup: PUBLIC } }, ORG, ID);
    expect(out).toEqual({ kind: "read", detail: "1 kept, 1 dropped" });
    const update = theUpdate(rec);
    expect(update.write!.payload).toMatchObject({ state: "read", generation_id: "gen-1", read_at: NOW.toISOString(), dropped: [{ index: 1, reason: "figure_not_in_quote", figure: "0.70" }] });
    expect((update.write!.payload as { reading: unknown[] }).reading).toHaveLength(1);
    expect(update.filters()).toEqual(expect.arrayContaining([{ col: "read_attempt", val: 1 }, { col: "state", val: "waiting" }]));
    expectOrgScoped(rec, ORG);
  });

  it("writes the office's words when the site refuses, and asks no model", async () => {
    const rec = world(row());
    const { client, create } = answering({ items: [] });
    const out = await readSwipeEntry({ admin: rec.client, client, now: () => NOW, page: { fetch: servePage("gone", 404), lookup: PUBLIC } }, ORG, ID);
    expect(out).toEqual({ kind: "unreadable", detail: "The site answered with an error." });
    expect(create).not.toHaveBeenCalled();
    expect(theUpdate(rec).write!.payload).toMatchObject({ state: "unreadable", last_error: "The site answered with an error." });
  });

  it("says nothing could be kept when every item failed the check, and keeps the drops for the person", async () => {
    const rec = world(row());
    const { client } = answering({ items: [{ topic: "pay", sentence: "They pay well.", quote: "Pay is great" }] });
    const out = await readSwipeEntry({ admin: rec.client, client, now: () => NOW, page: { fetch: servePage(PAGE), lookup: PUBLIC } }, ORG, ID);
    expect(out.kind).toBe("unreadable");
    expect(theUpdate(rec).write!.payload).toMatchObject({ state: "unreadable", dropped: [{ index: 0, reason: "quote_not_on_page" }] });
  });

  it("tells the office the Researcher is switched off, and asks no model", async () => {
    const rec = world(row(), false);
    const { client, create } = answering({ items: [] });
    const out = await readSwipeEntry({ admin: rec.client, client, now: () => NOW, page: { fetch: servePage(PAGE), lookup: PUBLIC } }, ORG, ID);
    expect(out).toEqual({ kind: "unreadable", detail: "The Researcher is switched off in the ads settings. Switch it on, then press Read again." });
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves an entry alone that is no longer waiting, removed, or gone", async () => {
    for (const entry of [row({ state: "read", reading: [], read_at: NOW.toISOString() }), row({ archived_at: NOW.toISOString() }), null]) {
      const rec = world(entry);
      const out = await readSwipeEntry({ admin: rec.client, client: answering({ items: [] }).client, now: () => NOW }, ORG, ID);
      expect(out.kind).toBe("skipped");
      expect(rec.forTable("ads_swipe_entries").some((q) => q.write)).toBe(false);
    }
  });
});

describe("the doors", () => {
  it("Read again moves to the next attempt only from the attempt it read, and clears the last reading", async () => {
    const rec = world(row({ state: "read", reading: [], read_at: NOW.toISOString(), read_attempt: 2 }));
    expect(await readAgain(rec.client, ORG, ID)).toEqual({ kind: "queued", attempt: 3 });
    const update = theUpdate(rec);
    expect(update.write!.payload).toMatchObject({ state: "waiting", read_attempt: 3, reading: null, read_at: null, last_error: null });
    expect(update.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "read_attempt", val: 2 }]));
  });

  it("Read again refuses an entry being read now, and a removed one", async () => {
    expect(await readAgain(world(row()).client, ORG, ID)).toEqual({ kind: "waiting" });
    expect(await readAgain(world(row({ state: "read", reading: [], read_at: NOW.toISOString(), archived_at: NOW.toISOString() })).client, ORG, ID)).toEqual({ kind: "not_found" });
  });

  it("removing archives the row, for this org, and deletes nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_swipe_entries: [{ id: ID }] } });
    expect(await archiveSwipe(rec.client, ORG, ID, NOW)).toBe(true);
    const q = rec.forTable("ads_swipe_entries")[0]!;
    expect(q.write).toEqual({ method: "update", payload: { archived_at: NOW.toISOString() } });
    expectOrgScoped(rec, ORG);
  });
});

describe("swipeEvidence", () => {
  it("asks for this org's read, live entries of the last 180 days, newest first, and writes each as evidence", async () => {
    const page = row({ state: "read", read_at: NOW.toISOString(), reading: [{ topic: "pay", sentence: "They pay up to $0.68 per mile.", quote: "Earn up to $0.68 per mile" }] });
    const picture = row({ id: "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", kind: "picture", url: null, asset: {}, state: "read", read_at: NOW.toISOString(),
      reading: { hook_family: "pay_first", scene_family: "cab_pov", words: [], summary: "It offers a cab view of a regional job." } });
    const rec = createSupabaseRecorder({ tables: { ads_swipe_entries: [page, picture] } });
    const items = await swipeEvidence(rec.client, ORG, NOW);
    expect(items.map((i) => i.id)).toEqual(["market:page_7a1b2c3d4e5f_1", "swipe:8a1b2c3d4e5f"]);
    const ops = rec.forTable("ads_swipe_entries")[0]!.ops;
    expect(ops).toEqual(expect.arrayContaining([
      { method: "eq", args: ["state", "read"] }, { method: "is", args: ["archived_at", null] },
      { method: "gte", args: ["read_at", "2026-05-22T18:00:00.000Z"] }, { method: "order", args: ["read_at", { ascending: false }] },
    ]));
    expectOrgScoped(rec, ORG);
  });

  it("writes nothing for a reading that no longer parses", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_swipe_entries: [row({ state: "read", read_at: NOW.toISOString(), reading: [{ topic: "salary" }] })] } });
    expect(await swipeEvidence(rec.client, ORG, NOW)).toEqual([]);
  });
});
