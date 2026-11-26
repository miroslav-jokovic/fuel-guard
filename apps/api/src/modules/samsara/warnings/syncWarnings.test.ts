import { describe, expect, it } from "vitest";
import type { WarningSource } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { testEnv } from "../../../testing/testEnv.js";
import { FIRST_RUN_DAYS, OVERLAP_MS, syncSamsaraWarnings } from "./syncWarnings.js";

const ORG = "org-1";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const env = testEnv({ SAMSARA_MAX_RPS: 1000, SAMSARA_MAX_RETRIES: 0, SAMSARA_REQUEST_TIMEOUT_MS: 0 });

type Route = (url: URL) => { status?: number; body?: unknown };
function fakeSamsara(route: Route) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const url = new URL(String(input));
    calls.push(url);
    const r = route(url);
    return new Response(JSON.stringify(r.body ?? { data: [], pagination: { hasNextPage: false } }), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const page = (data: unknown[]) => ({ body: { data, pagination: { hasNextPage: false, endCursor: "" } } });

function recorder(cursors: Record<string, string> = {}) {
  return createSupabaseRecorder({
    tables: {
      samsara_feed_cursors: (q) => {
        const feed = q.filters().find((f) => f.col === "feed")?.val as string | undefined;
        return feed && cursors[feed] ? [{ end_cursor: cursors[feed] }] : [];
      },
      samsara_warnings: [],
    },
  });
}

/** The cursor write is update-then-insert (feedCursor.ts); the INSERT is the row that names the feed. */
const cursorInserts = (rec: ReturnType<typeof recorder>) =>
  rec.forTable("samsara_feed_cursors").filter((q) => q.write?.method === "insert").map((q) => q.write?.payload as Record<string, unknown>);

const run = (rec: ReturnType<typeof recorder>, sources: WarningSource[], route: Route) => {
  const f = fakeSamsara(route);
  return {
    f,
    result: syncSamsaraWarnings(rec.client, env, ORG, {
      now: NOW,
      sources: new Set(sources),
      alertConfigs: [{ id: "cfg-1", name: "Critical Low Battery", isEnabled: true, triggerTypeIds: [1007, 1022] }],
      fetchImpl: f.fetchImpl,
      tokenOverride: "t",
    }),
  };
};

describe("syncSamsaraWarnings", () => {
  it("first run reads seven days back, writes org-scoped rows and advances the cursor", async () => {
    const rec = recorder();
    const { f, result } = run(rec, ["safety"], () =>
      page([{ id: "e1", startMs: "2026-11-25T10:00:00Z", driver: { id: "D1", name: "A" }, behaviorLabels: [{ label: "Braking" }], eventState: "needsCoaching" }]),
    );
    expect((await result).safety).toMatchObject({ fetched: 1, written: 1, refused: 0 });
    expect(f.calls[0]?.pathname).toBe("/safety-events/stream");
    expect(f.calls[0]?.searchParams.get("startTime")).toBe(new Date(NOW.getTime() - FIRST_RUN_DAYS * 86_400_000).toISOString());
    expect(rec.writtenRows("samsara_warnings")).toMatchObject([{ org_id: ORG, source: "safety", source_key: "e1", kind: "safety_other" }]);
    expect(cursorInserts(rec)).toMatchObject([{ org_id: ORG, feed: "warnings:safety", end_cursor: NOW.toISOString() }]);
    expectOrgScoped(rec, ORG);
  });

  it("a later run starts at the stored watermark less the overlap", async () => {
    const stored = "2026-11-26T11:55:00.000Z";
    const rec = recorder({ "warnings:dvir": stored });
    const { f, result } = run(rec, ["dvir"], () => page([]));
    await result;
    expect(f.calls[0]?.searchParams.get("startTime")).toBe(new Date(Date.parse(stored) - OVERLAP_MS).toISOString());
  });

  it("reads only the alert configurations whose rule is on, repeated as configurationIds", async () => {
    const rec = recorder();
    const { f, result } = run(rec, ["alert"], () => page([]));
    await result;
    expect(f.calls[0]?.searchParams.getAll("configurationIds")).toEqual(["cfg-1"]);
  });

  it("does not touch a source no rule switched on", async () => {
    const rec = recorder();
    const { f, result } = run(rec, ["safety"], () => page([]));
    await result;
    expect(f.calls.every((u) => u.pathname === "/safety-events/stream")).toBe(true);
  });

  it("a failing source keeps its watermark, the others still advance, and the run throws", async () => {
    const rec = recorder();
    const { result } = run(rec, ["safety", "dvir"], (url) => (url.pathname === "/defects/stream" ? { status: 500 } : page([])));
    await expect(result).rejects.toThrow(/dvir: Samsara \/defects\/stream answered 500/);
    const feeds = cursorInserts(rec).map((r) => r.feed);
    expect(feeds).toEqual(["warnings:safety"]);
  });

  it("folds ATIS readings into one episode row per leak", async () => {
    const rec = recorder();
    const { result } = run(rec, ["atis"], (url) =>
      url.pathname === "/readings/history"
        ? page([
            { entityId: "T1", value: "on", happenedAtTime: "2026-11-26T08:00:00Z" },
            { entityId: "T1", value: "off", happenedAtTime: "2026-11-26T08:40:00Z" },
            { entityId: "T2", value: "off", happenedAtTime: "2026-11-26T08:00:00Z" },
          ])
        : page([]),
    );
    expect((await result).atis?.written).toBe(1);
    expect(rec.writtenRows("samsara_warnings")).toMatchObject([
      { source: "atis", kind: "atis", subject_kind: "trailer", trailer_samsara_id: "T1", still_active: false, ended_at: "2026-11-26T08:40:00.000Z" },
    ]);
  });

  it("opens a lamp episode for a truck whose STOP lamp is on and skips sold trucks", async () => {
    const rec = recorder();
    const lamps = (stop: boolean) => ({ checkEngineLights: { stopIsOn: stop, warningIsOn: false, emissionsIsOn: false } });
    const { result } = run(rec, ["lamp"], () =>
      page([
        { id: "V1", name: "664", faultCodes: { j1939: lamps(true) } },
        { id: "V2", name: "556 - SOLD", faultCodes: { j1939: lamps(true) } },
      ]),
    );
    expect((await result).lamp).toMatchObject({ written: 1, refused: 1 });
    expect(rec.writtenRows("samsara_warnings")).toMatchObject([{ kind: "lamp_stop", vehicle_samsara_id: "V1", still_active: true }]);
  });

  it("reads HOS at most hourly", async () => {
    const rec = recorder({ "warnings:hos": "2026-11-26T11:30:00.000Z" });
    const { f, result } = run(rec, ["hos"], () => page([]));
    expect((await result).hos?.skipped).toBe("not due");
    expect(f.calls).toHaveLength(0);
  });
});
