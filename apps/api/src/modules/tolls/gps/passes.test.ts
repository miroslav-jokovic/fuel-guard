import { beforeEach, describe, expect, it } from "vitest";
import { tollGps, wallClockInZone } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import type { AssetGpsFetcher } from "../../samsara/index.js";
import { duePlazas, knownByPlaza, learnPlazas } from "./plazaPass.js";
import { dueCheckpoints, observeTolls } from "./observationPass.js";
import { forgetTollGpsCache, type PlazaRow } from "./store.js";
import { zoneAt } from "./scheduler.js";

/**
 * The toll GPS check's two passes (TOLLS-PER-TRUCK-PLAN TL8a). The rules themselves are proved in
 * `packages/shared/src/tolls/gps/gps.test.ts` and on the owner's real statements (D-TL21); 0636's
 * guards in `supabase/tests/toll-plazas.test.mjs`. What is left is this path: which tolls count as
 * known, which plazas and checkpoints are due, what Samsara is asked and in what order, that nothing is
 * stored from a window Samsara did not finish, and that every query names the org. The recorder does
 * not filter, so each fixture applies the filters its query asked for.
 */

const ORG = "org-1";
const PLAZA = { lat: 37.2437, lon: -97.3387 }; // Kansas Turnpike, Southern Terminal (placed on real data 11-19)
const CHI = "America/Chicago";
const val = (q: RecordedQuery, col: string) => q.ops.find((o) => o.method === "eq" && o.args[0] === col)?.args[1];
const inList = (q: RecordedQuery, col: string) => (q.ops.find((o) => o.method === "in" && o.args[0] === col)?.args[1] ?? []) as string[];
const pad = (n: number) => String(n).padStart(2, "0");
const localOf = (ms: number) => {
  const w = wallClockInZone(new Date(ms), CHI);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:00`;
};
/** June `d`, 14:00Z + d minutes: when the truck passed (40 s after the printed minute). */
const passOn = (d: number) => Date.UTC(2026, 5, d, 14, d) + 40_000;

/** Samsara gps records for a truck driving north through `through` at `passMs`, a fix every 10 s for ±5 h. */
function gpsThrough(passMs: number, through = PLAZA, heading = 0) {
  const h = (heading * Math.PI) / 180;
  const gps = [];
  for (let t = -5 * 3600; t <= 5 * 3600; t += 10) {
    const m = 28 * t;
    gps.push({ time: new Date(passMs + t * 1000).toISOString(), latitude: through.lat + (m * Math.cos(h)) / 111_320, longitude: through.lon + (m * Math.sin(h)) / (111_320 * Math.cos((through.lat * Math.PI) / 180)) });
  }
  return gps;
}

const line = (id: string, d: number, over: Record<string, unknown> = {}) => ({
  id, org_id: ORG, statement_id: "st-1", kind: "toll", tag_number: "KTA.0001", plate: null, agency: "KTA", entry_plaza: null, entry_at: null,
  exit_plaza: "017 SB", exit_at: localOf(passOn(d) - 40_000), location: "Southern Terminal", ...over,
});
const KEY = tollGps.plazaKeyOf("ktag", "exit", "KTA", "017 SB", "Southern Terminal");

function recorder(o: { lines: Record<string, unknown>[]; plazas?: Record<string, unknown>[]; observed?: Record<string, unknown>[]; assignments?: Record<string, unknown>[] }) {
  return createSupabaseRecorder({
    tables: {
      organizations: (q) => (val(q, "id") === ORG ? [{ operating_hours: { tz: CHI } }] : []),
      toll_statements: (q) => [{ id: "st-1", provider: "ktag", org_id: ORG }, { id: "st-9", provider: "ktag", org_id: "org-2" }].filter((s) => s.org_id === val(q, "org_id")),
      toll_statement_lines: (q) => o.lines.filter((l) => l.org_id === val(q, "org_id") && inList(q, "statement_id").includes(String(l.statement_id)) && l.kind === val(q, "kind")),
      toll_transponders: (q) => [{ id: "tr-1", provider: "ktag", tag_number: "KTA0001", org_id: ORG }].filter((t) => t.org_id === val(q, "org_id")),
      toll_transponder_assignments: (q) =>
        (o.assignments ?? [{ transponder_id: "tr-1", vehicle_id: "veh-1", valid_from: "2026-01-01T00:00:00Z", valid_to: null, voided_at: null, org_id: ORG }]).filter((a) => a.org_id === val(q, "org_id")),
      vehicles: (q) => [{ id: "veh-1", samsara_vehicle_id: "111", org_id: ORG }].filter((v) => v.org_id === val(q, "org_id")),
      toll_plazas: (q) => (q.write ? [] : (o.plazas ?? []).filter((p) => p.org_id === val(q, "org_id") && p.engine_version === val(q, "engine_version"))),
      toll_line_observations: (q) => (q.write ? [] : (o.observed ?? []).filter((r) => r.org_id === val(q, "org_id"))),
    },
  });
}

beforeEach(() => forgetTollGpsCache());

describe("which tolls teach a plaza", () => {
  const lines = [1, 2, 3].map((d) => ({ id: `l${d}`, provider: "ktag" as const, kind: "toll", tagNumber: "KTA.0001", plate: null, agency: "KTA", entryPlaza: null, entryAt: null, exitPlaza: "017 SB", exitAt: localOf(passOn(d) - 40_000), location: "Southern Terminal" }));
  const history = new Map([["ktag:KTA0001", [{ vehicleId: "veh-1", validFrom: "2026-01-01T00:00:00Z", validTo: null, voided: false }]]]);
  it("a toll whose tag the history gives to one truck with a Samsara id is known", () => {
    const k = knownByPlaza(lines, history, new Map([["veh-1", "111"]]), CHI).get(KEY)!;
    expect(k.tolls).toBe(3);
    expect(k.known.map((x) => [x.lineId, x.vehicleId, x.samsaraVehicleId])).toEqual([["l1", "veh-1", "111"], ["l2", "veh-1", "111"], ["l3", "veh-1", "111"]]);
  });
  it("a toll near a swap, an unknown tag, or a truck with no Samsara is counted but not known", () => {
    const swap = new Map([["ktag:KTA0001", [{ vehicleId: "veh-1", validFrom: new Date(passOn(2)).toISOString(), validTo: null, voided: false }]]]);
    expect(knownByPlaza(lines, swap, new Map([["veh-1", "111"]]), CHI).get(KEY)!.known.map((x) => x.lineId)).toEqual(["l3"]);
    expect(knownByPlaza(lines, new Map(), new Map([["veh-1", "111"]]), CHI).get(KEY)).toMatchObject({ tolls: 3, known: [] });
    expect(knownByPlaza(lines, history, new Map(), CHI).get(KEY)!.known).toEqual([]);
  });
  it("tries a plaza with no attempt, or one not placed that has more known tolls since; never a placed one", () => {
    const k = (n: number) => ({ provider: "ktag" as const, role: "exit" as const, tolls: n, known: Array.from({ length: n }, () => ({}) as tollGps.KnownToll) });
    const cands = new Map([["a", k(3)], ["b", k(9)], ["c", k(5)], ["d", k(4)], ["e", k(2)]]);
    const row = (outcome: string, known_count: number) => ({ outcome, known_count }) as PlazaRow;
    const current = new Map([["c", row("placed", 3)], ["d", row("not_placed", 4)], ["a", row("not_placed", 2)]]);
    expect(duePlazas(cands, current)).toEqual(["b", "a"]);
  });
});

describe("learnPlazas", () => {
  const LINES = [1, 2, 3, 4].map((d) => line(`l${d}`, d));
  const fetchFrom = (complete = true): AssetGpsFetcher & { calls: string[][] } => {
    const calls: string[][] = [];
    const f = (async (ids: string[], startIso: string) => {
      calls.push(ids);
      const d = [1, 2, 3, 4].find((day) => Math.abs(passOn(day) - Date.parse(startIso)) < 6 * 3600_000)!;
      return { data: [{ id: ids[0], gps: gpsThrough(passOn(d), PLAZA, d * 70) }], complete };
    }) as unknown as AssetGpsFetcher & { calls: string[][] };
    f.calls = calls;
    return f;
  };

  it("places the plaza from the known trucks' tracks, in the zone the tz dataset gives there, and keeps the attempt", async () => {
    const rec = recorder({ lines: LINES });
    const fetch = fetchFrom();
    expect(await learnPlazas(rec.client, ORG, { fetchGps: fetch, zoneAt })).toEqual({ placed: 1, not_placed: 0 });
    expect(fetch.calls).toHaveLength(4);
    expect(fetch.calls.every((c) => c.length === 1 && c[0] === "111")).toBe(true);
    const [row] = rec.writtenRows("toll_plazas");
    expect(row).toMatchObject({ org_id: ORG, provider: "ktag", role: "exit", plaza_key: KEY, outcome: "placed", time_zone: CHI, known_count: 4, engine_version: tollGps.PLAZA_ENGINE_VERSION });
    expect(tollGps.distanceM({ lat: row!.lat as number, lon: row!.lon as number }, PLAZA)).toBeLessThan(100);
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
    expect(rec.forTable("organizations")[0]!.filters()).toContainEqual({ col: "id", val: ORG });
  });

  it("keeps nothing when Samsara does not finish sending a track", async () => {
    const rec = recorder({ lines: LINES });
    await expect(learnPlazas(rec.client, ORG, { fetchGps: fetchFrom(false), zoneAt })).rejects.toThrow(/incomplete/);
    expect(rec.writtenRows("toll_plazas")).toEqual([]);
  });

  it("does not try again a plaza placed at this version", async () => {
    const rec = recorder({ lines: LINES, plazas: [{ org_id: ORG, engine_version: tollGps.PLAZA_ENGINE_VERSION, plaza_key: KEY, outcome: "placed", known_count: 4, created_at: "2026-11-19T00:00:00Z", id: "p1" }] });
    const fetch = fetchFrom();
    expect(await learnPlazas(rec.client, ORG, { fetchGps: fetch, zoneAt })).toEqual({ placed: 0, not_placed: 0 });
    expect(fetch.calls).toEqual([]);
  });
});

describe("observeTolls", () => {
  const PLACED = { id: "p1", org_id: ORG, engine_version: tollGps.PLAZA_ENGINE_VERSION, provider: "ktag", role: "exit", plaza_key: KEY, outcome: "placed", known_count: 4, lat: PLAZA.lat, lon: PLAZA.lon, time_zone: CHI, offset_s: 40, offset_spread_s: 20, created_at: "2026-11-19T00:00:00Z" };
  const LINES = [
    line("l3", 3),
    line("l1", 1),
    line("plate", 2, { tag_number: null, plate: "P1234567" }),
    line("autumn", 1, { exit_at: "2026-11-01T01:30:00" }),
    line("spring", 1, { exit_at: "2026-03-08T02:30:00" }),
  ];
  function deps(o: { complete?: boolean; clockStep?: number; badId?: boolean } = {}) {
    const vehicleCalls: { ids: string[]; startMs: number }[] = [];
    const trailerCalls: { ids: string[]; startMs: number }[] = [];
    let now = 0;
    const answer = (ids: string[], startIso: string) => {
      const start = Date.parse(startIso);
      const day = [1, 2, 3].find((d) => Math.abs(passOn(d) - start) < 3600_000)!;
      return ids.map((id) => ({ id, gps: id === "111" ? gpsThrough(passOn(day)) : id === "222" ? gpsThrough(passOn(day), { lat: PLAZA.lat + 1, lon: PLAZA.lon }) : [] }));
    };
    return {
      vehicleCalls,
      trailerCalls,
      d: {
        fetchVehicles: (async (ids: string[], s: string) => {
          vehicleCalls.push({ ids, startMs: Date.parse(s) });
          return { data: answer(ids, s), complete: o.complete ?? true };
        }) as AssetGpsFetcher,
        fetchTrailers: (async (ids: string[], s: string) => {
          trailerCalls.push({ ids, startMs: Date.parse(s) });
          return { data: answer(ids, s), complete: true };
        }) as AssetGpsFetcher,
        listVehicles: async () => [{ id: "111" }, { id: "222" }, { id: o.badId ? "veh-x" : "333" }],
        listTrailers: async () => [{ id: "900" }],
        nowMs: () => (now += o.clockStep ?? 0),
      },
    };
  }

  it("observes every toll at a placed plaza, oldest window first, and records the clock outcomes without a fetch", async () => {
    const rec = recorder({ lines: LINES, plazas: [PLACED] });
    const { d, vehicleCalls, trailerCalls } = deps();
    expect(await observeTolls(rec.client, ORG, d)).toEqual({ observed: 3, clock: 2, windows: 3, waiting: 0 });
    expect(vehicleCalls.map((c) => c.startMs)).toEqual([...vehicleCalls.map((c) => c.startMs)].sort((a, b) => a - b));
    expect(vehicleCalls.every((c) => c.ids.join() === "111,222,333")).toBe(true);
    // Trailers only for the window holding the toll billed by plate.
    expect(trailerCalls).toHaveLength(1);
    const rows = rec.writtenRows("toll_line_observations");
    expect(rows.filter((r) => r.outcome !== "observed").map((r) => [r.line_id, r.outcome])).toEqual([["autumn", "clock_ambiguous"], ["spring", "clock_skipped"]]);
    const l1 = rows.find((r) => r.line_id === "l1")!;
    expect(l1).toMatchObject({ org_id: ORG, role: "exit", plaza_id: "p1", outcome: "observed", half_window_s: 90, reporting: ["111", "222"] });
    expect(l1.nearby).toEqual([expect.objectContaining({ samsaraId: "111", kind: "vehicle" })]);
    expect(Date.parse(l1.at as string)).toBe(passOn(1));
    expectOrgScoped(rec, ORG);
  });

  it("stores nothing from a window Samsara did not finish sending", async () => {
    const rec = recorder({ lines: [line("l1", 1)], plazas: [PLACED] });
    await expect(observeTolls(rec.client, ORG, deps({ complete: false }).d)).rejects.toThrow(/incomplete/);
    expect(rec.writtenRows("toll_line_observations")).toEqual([]);
  });

  it("refuses a Samsara id that is not a number rather than dropping it", async () => {
    const rec = recorder({ lines: [line("l1", 1)], plazas: [PLACED] });
    const { d } = deps({ badId: true });
    d.fetchVehicles = (async (ids: string[]) => ({ data: ids.map((id) => ({ id, gps: gpsThrough(passOn(1)) })), complete: true })) as AssetGpsFetcher;
    await expect(observeTolls(rec.client, ORG, d)).rejects.toThrow(/not a number/);
  });

  it("stops at the time budget and leaves the rest waiting for the next tick", async () => {
    const rec = recorder({ lines: [line("l1", 1), line("l3", 3)], plazas: [PLACED] });
    expect(await observeTolls(rec.client, ORG, deps({ clockStep: 60_000 }).d, 90_000)).toEqual({ observed: 1, clock: 0, windows: 1, waiting: 1 });
  });

  it("skips a toll already observed at that plaza, and a toll whose plaza is not placed", () => {
    const lines = [1, 2].map((d) => ({ id: `l${d}`, provider: "ktag" as const, kind: "toll", tagNumber: "KTA.0001", plate: null, agency: "KTA", entryPlaza: null, entryAt: null, exitPlaza: "017 SB", exitAt: localOf(passOn(d)), location: "Southern Terminal" }));
    const placed = new Map([[KEY, PLACED as unknown as PlazaRow]]);
    expect(dueCheckpoints(lines, placed, new Set(["l1|exit|p1"]), ORG).due.map((x) => x.lineId)).toEqual(["l2"]);
    expect(dueCheckpoints(lines, new Map([[KEY, { ...PLACED, outcome: "not_placed" } as unknown as PlazaRow]]), new Set(), ORG).due).toEqual([]);
  });
});
