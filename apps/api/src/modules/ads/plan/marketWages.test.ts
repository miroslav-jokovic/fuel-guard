import { describe, expect, it } from "vitest";
import { oewsSeriesFor } from "@silvicom/shared";
import { createSupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { askBls, BLS_API, blsMarketReader, FRESH_DAYS, wageFacts } from "./marketWages.js";

const NOW = new Date("2026-11-18T18:00:00Z");
const NATION = Object.values(oewsSeriesFor({ kind: "nation" })!);
const IL = Object.values(oewsSeriesFor({ kind: "state", code: "IL" })!);
// The API's answers of 2026-11-18, in the order of `OEWS_MEASURES`: median, hourly median, 10th, 90th.
const NATION_VALUES = ["58640", "28.19", "40140", "79380"];
const IL_VALUES = ["60320", "29.00", "39710", "86300"];

const series = (ids: string[], values: Array<string | null>) =>
  ids.map((id, i) => ({ seriesID: id, data: values[i] === null ? [] : [{ year: "2025", period: "A01", periodName: "Annual", latest: "true", value: values[i]!, footnotes: [{}] }] }));
const succeeded = (s: unknown[]) => ({ status: "REQUEST_SUCCEEDED", responseTime: 30, message: [], Results: { series: s } });

function fakeFetch(answer: unknown, status = 200) {
  const calls: Array<{ url: string; body: { seriesid: string[] } }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const failingFetch = (async () => { throw new Error("getaddrinfo ENOTFOUND api.bls.gov"); }) as unknown as typeof fetch;

const kept = (ids: string[], values: Array<string | null>, fetched_at: string) =>
  ids.map((series_id, i) => ({ series_id, year: values[i] === null ? null : 2025, value: values[i], fetched_at }));

describe("askBls", () => {
  it("asks every series in one request and keeps the latest annual value of each, and no value for a series with none", async () => {
    const { f, calls } = fakeFetch(succeeded(series(NATION, [...NATION_VALUES.slice(0, 3), null])));
    const out = await askBls({ fetch: f }, NATION);
    expect(calls).toEqual([{ url: BLS_API, body: { seriesid: NATION } }]);
    expect(out).toEqual({ ok: true, facts: [
      { series_id: NATION[0], year: 2025, value: 58640 }, { series_id: NATION[1], year: 2025, value: 28.19 },
      { series_id: NATION[2], year: 2025, value: 40140 }, { series_id: NATION[3], year: 0, value: null },
    ] });
  });

  it("is a failure, not an empty answer, when the day's requests are spent, the address fails or the body is not the API's", async () => {
    expect(await askBls({ fetch: fakeFetch({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold reached"] }).f }, NATION))
      .toEqual({ ok: false, error: "REQUEST_NOT_PROCESSED: daily threshold reached" });
    // A status other than success fails the read even when series came with it: they may be partial.
    expect(await askBls({ fetch: fakeFetch({ ...succeeded(series(NATION, NATION_VALUES)), status: "REQUEST_NOT_PROCESSED", message: ["partial"] }).f }, NATION))
      .toEqual({ ok: false, error: "REQUEST_NOT_PROCESSED: partial" });
    expect(await askBls({ fetch: fakeFetch({}, 503).f }, NATION)).toEqual({ ok: false, error: "HTTP 503" });
    expect(await askBls({ fetch: failingFetch }, NATION)).toEqual({ ok: false, error: "getaddrinfo ENOTFOUND api.bls.gov" });
    expect(await askBls({ fetch: fakeFetch({ hello: 1 }).f }, NATION)).toEqual({ ok: false, error: "the answer was not in the API's shape" });
  });

  it("keeps no value for a withheld figure BLS writes as a dash", async () => {
    const out = await askBls({ fetch: fakeFetch(succeeded(series(NATION.slice(0, 1), ["-"]))).f }, NATION.slice(0, 1));
    expect(out).toEqual({ ok: true, facts: [{ series_id: NATION[0], year: 0, value: null }] });
  });
});

describe("wageFacts", () => {
  it("asks BLS only for the series not kept or kept longer than 30 days, and writes each answer back", async () => {
    const fresh = new Date(NOW.getTime() - (FRESH_DAYS - 1) * 86_400_000).toISOString();
    const old = new Date(NOW.getTime() - (FRESH_DAYS + 1) * 86_400_000).toISOString();
    const rec = createSupabaseRecorder({ tables: { ads_market_wages: [...kept(NATION, NATION_VALUES, fresh), ...kept(IL.slice(0, 2), IL_VALUES.slice(0, 2), old)] } });
    const { f, calls } = fakeFetch(succeeded(series(IL, IL_VALUES)));
    const facts = await wageFacts({ admin: rec.client, now: () => NOW, stateOf: async () => null, fetch: f }, [...NATION, ...IL]);
    expect(calls[0]!.body.seriesid).toEqual(IL);
    const upsert = rec.forTable("ads_market_wages").find((c) => c.ops.some((o) => o.method === "upsert"))!;
    expect(upsert.ops.find((o) => o.method === "upsert")!.args).toEqual([
      IL.map((id, i) => ({ series_id: id, year: 2025, value: Number(IL_VALUES[i]), fetched_at: NOW.toISOString() })), { onConflict: "series_id" },
    ]);
    expect(facts.map((x) => x.value)).toEqual([...NATION_VALUES, ...IL_VALUES].map(Number));
  });

  it("writes a series with no figure with neither a year nor a value", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_market_wages: [] } });
    await wageFacts({ admin: rec.client, now: () => NOW, stateOf: async () => null, fetch: fakeFetch(succeeded(series(NATION.slice(0, 1), [null]))).f }, NATION.slice(0, 1));
    const upsert = rec.forTable("ads_market_wages").find((c) => c.ops.some((o) => o.method === "upsert"))!;
    expect((upsert.ops.find((o) => o.method === "upsert")!.args[0] as unknown[])[0]).toEqual({ series_id: NATION[0], year: null, value: null, fetched_at: NOW.toISOString() });
  });

  it("plans from kept rows, however old, when BLS cannot be reached, and asks nothing when every row is fresh", async () => {
    const old = new Date(NOW.getTime() - 400 * 86_400_000).toISOString();
    const rec = createSupabaseRecorder({ tables: { ads_market_wages: kept(NATION, NATION_VALUES, old) } });
    const facts = await wageFacts({ admin: rec.client, now: () => NOW, stateOf: async () => null, fetch: failingFetch }, NATION);
    expect(facts.map((x) => x.value)).toEqual(NATION_VALUES.map(Number));
    expect(rec.forTable("ads_market_wages").some((c) => c.ops.some((o) => o.method === "upsert"))).toBe(false);

    const freshRec = createSupabaseRecorder({ tables: { ads_market_wages: kept(NATION, NATION_VALUES, NOW.toISOString()) } });
    const { f, calls } = fakeFetch(succeeded([]));
    await wageFacts({ admin: freshRec.client, now: () => NOW, stateOf: async () => null, fetch: f }, NATION);
    expect(calls).toEqual([]);
  });
});

describe("blsMarketReader", () => {
  const area = { latitude: 41.88, longitude: -87.63 };

  it("reads the nation and the state of the area's centre", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_market_wages: [] } });
    const { f, calls } = fakeFetch(succeeded([...series(NATION, NATION_VALUES), ...series(IL, IL_VALUES)]));
    const asked: Array<[number, number]> = [];
    const items = await blsMarketReader({ admin: rec.client, now: () => NOW, fetch: f, stateOf: async (lat, lng) => { asked.push([lat, lng]); return "IL"; } }).itemsFor(area);
    expect(asked).toEqual([[41.88, -87.63]]);
    expect(calls[0]!.body.seriesid).toEqual([...NATION, ...IL]);
    expect(items.map((i) => i.id)).toEqual(["market:oews_il", "market:oews_us"]);
  });

  it("reads the nation alone when the centre is a province, unknown, or the geocoder throws", async () => {
    for (const stateOf of [async () => "ON", async () => null, async () => { throw new Error("HERE 503"); }]) {
      const rec = createSupabaseRecorder({ tables: { ads_market_wages: [] } });
      const { f, calls } = fakeFetch(succeeded(series(NATION, NATION_VALUES)));
      const items = await blsMarketReader({ admin: rec.client, now: () => NOW, fetch: f, stateOf }).itemsFor(area);
      expect(calls[0]!.body.seriesid).toEqual(NATION);
      expect(items.map((i) => i.id)).toEqual(["market:oews_us"]);
    }
  });

  it("answers no item, and does not fail the plan, when BLS cannot be reached and nothing is kept", async () => {
    const rec = createSupabaseRecorder({ tables: { ads_market_wages: [] } });
    expect(await blsMarketReader({ admin: rec.client, now: () => NOW, fetch: failingFetch, stateOf: async () => "IL" }).itemsFor(area)).toEqual([]);
  });
});
