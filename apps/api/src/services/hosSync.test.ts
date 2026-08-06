/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncHosDutySegments, syncHosCurrentStatus } from "./hosSync.js";
import type { Env } from "../env.js";

/** Same tiny chainable Supabase fake used by idleSync.test — awaiting a node yields the table fixture;
 *  .upsert() captures written rows; .update() captures patches (chainable, resolves ok). */
function makeAdmin(fixtures: Record<string, { data: unknown }>) {
  const captured: Record<string, Record<string, unknown>[]> = {};
  const updates: Record<string, Record<string, unknown>[]> = {};
  const deleted: Record<string, unknown[]> = {};
  function node(table: string): any {
    const result = fixtures[table] ?? { data: [] };
    const proxy: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
        if (prop === "upsert")
          return (rows: unknown) => {
            const arr = Array.isArray(rows) ? rows : [rows];
            (captured[table] ||= []).push(...(arr as Record<string, unknown>[]));
            return Promise.resolve({ error: null });
          };
        if (prop === "update")
          return (patch: Record<string, unknown>) => {
            (updates[table] ||= []).push(patch);
            return proxy; // still chainable (.eq().eq()); awaiting resolves the fixture ({error:undefined})
          };
        if (prop === "delete")
          return () => {
            const delProxy: any = new Proxy(function () {}, {
              get(_t2, p2) {
                if (p2 === "in")
                  return (_col: string, ids: unknown[]) => {
                    (deleted[table] ||= []).push(...ids);
                    return delProxy;
                  };
                if (p2 === "then") return (resolve: (v: unknown) => unknown) => resolve({ error: null });
                return () => delProxy;
              },
              apply: () => delProxy,
            });
            return delProxy;
          };
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return {
    admin: { from: (t: string) => node(t) } as unknown as SupabaseClient,
    captured,
    updates,
    deleted,
  };
}

const env = {} as Env;
const T0 = Date.parse("2026-06-01T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000;

describe("syncHosDutySegments (end-to-end)", () => {
  it("parses HOS logs into contiguous segments, resolves drivers, and upserts", async () => {
    const { admin, captured } = makeAdmin({
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] }, // op2 intentionally unmatched
    });
    const hosFetcher = async () => ({
      data: [
        {
          driver: { id: "op1" },
          logs: [
            { logStartTime: iso(T0), dutyStatus: "driving" },
            { logStartTime: iso(T0 + 2 * H), dutyStatus: "sleeperBed" },
          ],
        },
        { driver: { id: "op2" }, logs: [{ logStartTime: iso(T0 + H), dutyStatus: "onDuty" }] },
      ],
    });

    const res = await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 10 * H),
      hosFetcher,
    });

    expect(res.fetched).toBe(3);
    expect(res.upserted).toBe(3);
    const rows = captured.hos_duty_segments!;
    // op1 resolves to d1; op2 stays null but is still stored.
    const op1 = rows.filter((r) => r.samsara_driver_id === "op1");
    expect(op1.map((r) => r.status)).toEqual(["driving", "sleeper"]);
    expect(op1.every((r) => r.driver_id === "d1")).toBe(true);
    // driving segment ends where sleeper begins; sleeper (open) runs to the window end.
    expect(op1[0]!.ended_at).toBe(iso(T0 + 2 * H));
    expect(op1[1]!.ended_at).toBe(iso(T0 + 10 * H));
    const op2 = rows.find((r) => r.samsara_driver_id === "op2")!;
    expect(op2.driver_id).toBeNull();
    expect(op2.status).toBe("on_duty");
  });

  it("P1: a stored segment the authoritative fetch no longer contains is REMOVED — but only for drivers present in the response", async () => {
    // An edited ELD log shifts a segment's start; the upsert key (driver, started_at) then inserts
    // the new row and the stale one used to linger — overlapping timelines feeding attribution.
    const { admin, deleted } = makeAdmin({
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      hos_duty_segments: {
        data: [
          // op1's OLD segment at a start the fresh response no longer has → orphan, must be deleted.
          { id: "seg-stale", samsara_driver_id: "op1", started_at: iso(T0 + 30 * 60_000), driver_id: "d1", status: "driving", ended_at: iso(T0 + 2 * H), samsara_vehicle_id: null, vehicle_id: null },
          // op9 is ABSENT from this response (pagination/permissions) — silence is not authority; keep.
          { id: "seg-keep", samsara_driver_id: "op9", started_at: iso(T0 + H), driver_id: null, status: "off_duty", ended_at: null, samsara_vehicle_id: null, vehicle_id: null },
        ],
      },
    });
    const hosFetcher = async () => ({
      data: [{ driver: { id: "op1" }, logs: [{ logStartTime: iso(T0), dutyStatus: "driving" }] }],
    });
    const res = await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0), endIso: iso(T0 + 10 * H), hosFetcher,
    });
    expect(res.removed).toBe(1);
    expect(deleted.hos_duty_segments).toEqual(["seg-stale"]); // op9's row untouched
  });

  it("returns zero and warns when items arrive but nothing parses (shape drift guard)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, captured } = makeAdmin({ drivers: { data: [] } });
    // A malformed item: no recognizable driver id / logs → 0 segments although data is non-empty.
    const hosFetcher = async () => ({ data: [{ unexpected: true, entries: [{ ts: "x" }] }] });
    const res = await syncHosDutySegments(admin, env, "org1", {
      hosFetcher,
      startIso: iso(T0),
      endIso: iso(T0 + H),
    });
    expect(res).toEqual({ fetched: 0, upserted: 0, removed: 0 });
    expect(captured.hos_duty_segments).toBeUndefined(); // nothing written
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).toContain("0 segments parsed");
    warn.mockRestore();
  });

  it("does not warn on a genuinely empty window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = makeAdmin({ drivers: { data: [] } });
    const res = await syncHosDutySegments(admin, env, "org1", {
      hosFetcher: async () => ({ data: [] }),
      startIso: iso(T0),
      endIso: iso(T0 + H),
    });
    expect(res).toEqual({ fetched: 0, upserted: 0, removed: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("syncHosCurrentStatus (clocks + GPS city)", () => {
  const clocksFetcher = async () => ({
    data: [
      {
        driver: { id: "op1" },
        currentVehicle: { id: "v100", name: "556" },
        currentDutyStatus: { hosStatusType: "driving" },
      },
      {
        driver: { id: "op2" }, // no current vehicle → status stamped, location honestly null
        currentDutyStatus: { hosStatusType: "offDuty" },
      },
      {
        driver: { id: "op9" }, // not in our drivers table → skipped entirely
        currentVehicle: { id: "v900", name: "999" },
        currentDutyStatus: { hosStatusType: "onDuty" },
      },
    ],
  });
  const drivers = {
    data: [
      { id: "d1", samsara_driver_id: "op1" },
      { id: "d2", samsara_driver_id: "op2" },
    ],
  };

  it("stamps status + truck + current city from the truck's GPS snapshot", async () => {
    const { admin, updates } = makeAdmin({ drivers });
    const gpsFetcher = async () => ({
      data: [
        {
          id: "v100",
          gps: {
            latitude: 37.38,
            longitude: -122.05,
            reverseGeo: { formattedLocation: "Butano Avenue, Sunnyvale, CA" },
          },
        },
      ],
    });
    const res = await syncHosCurrentStatus(admin, {} as Env, "org1", { clocksFetcher, gpsFetcher });
    expect(res).toEqual({ drivers: 2, located: 1 });
    const patches = updates.drivers!;
    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({
      current_hos_status: "driving",
      current_hos_vehicle: "556",
      current_location: "Sunnyvale, CA",
    });
    // Driver with no current vehicle: location cleared, not left stale.
    expect(patches[1]).toMatchObject({ current_hos_status: "off_duty", current_location: null });
  });

  it("omits current_location entirely when the GPS snapshot fails (stale beats blank)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, updates } = makeAdmin({ drivers });
    const gpsFetcher = async () => {
      throw new Error("Samsara API 500");
    };
    const res = await syncHosCurrentStatus(admin, {} as Env, "org1", { clocksFetcher, gpsFetcher });
    expect(res).toEqual({ drivers: 2, located: 0 });
    for (const p of updates.drivers!) {
      expect("current_location" in p).toBe(false);
      expect(p.current_hos_status).toBeDefined(); // the status sync itself still ran
    }
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("clears the city for a truck without a GPS fix", async () => {
    const { admin, updates } = makeAdmin({ drivers });
    const gpsFetcher = async () => ({ data: [] }); // snapshot succeeded, but no fixes reported
    const res = await syncHosCurrentStatus(admin, {} as Env, "org1", { clocksFetcher, gpsFetcher });
    expect(res).toEqual({ drivers: 2, located: 0 });
    expect(updates.drivers![0]).toMatchObject({ current_location: null });
  });
});

describe("syncHosDutySegments — diff-before-write + chunked fetch", () => {
  it("skips segments already stored identically; writes only new/changed rows", async () => {
    const { admin, captured } = makeAdmin({
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      // The driving segment is already stored EXACTLY as it will parse → must be skipped.
      hos_duty_segments: {
        data: [
          {
            samsara_driver_id: "op1",
            driver_id: "d1",
            status: "driving",
            started_at: iso(T0),
            ended_at: iso(T0 + 2 * H),
          },
        ],
      },
    });
    const hosFetcher = async () => ({
      data: [
        {
          driver: { id: "op1" },
          hosLogs: [
            { logStartTime: iso(T0), hosStatusType: "driving" },
            { logStartTime: iso(T0 + 2 * H), hosStatusType: "sleeperBed" },
          ],
        },
      ],
    });
    const res = await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 10 * H),
      hosFetcher,
    });
    expect(res.fetched).toBe(2);
    expect(res.upserted).toBe(1); // only the sleeper segment is new
    expect(captured.hos_duty_segments!.map((r) => r.status)).toEqual(["sleeper"]);
  });

  it("rewrites a stored segment whose ended_at moved (open segment closed by a later log)", async () => {
    const { admin, captured } = makeAdmin({
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      hos_duty_segments: {
        data: [
          {
            samsara_driver_id: "op1",
            driver_id: "d1",
            status: "sleeper",
            started_at: iso(T0),
            ended_at: iso(T0 + 2 * H), // previously closed at the old window edge
          },
        ],
      },
    });
    const hosFetcher = async () => ({
      data: [
        {
          driver: { id: "op1" },
          hosLogs: [
            { logStartTime: iso(T0), hosStatusType: "sleeperBed" },
            { logStartTime: iso(T0 + 5 * H), hosStatusType: "driving" }, // real end arrived
          ],
        },
      ],
    });
    const res = await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 10 * H),
      hosFetcher,
    });
    expect(res.upserted).toBe(2); // sleeper re-written with its true end + the new driving segment
    const sleeper = captured.hos_duty_segments!.find((r) => r.status === "sleeper")!;
    expect(sleeper.ended_at).toBe(iso(T0 + 5 * H));
  });

  it("never unlinks an already-linked driver when the id no longer resolves", async () => {
    const { admin, captured } = makeAdmin({
      drivers: { data: [] }, // op1 no longer resolvable (e.g. deactivated)
      hos_duty_segments: {
        data: [
          {
            samsara_driver_id: "op1",
            driver_id: "d1", // linked by an earlier sync
            status: "driving",
            started_at: iso(T0),
            ended_at: iso(T0 + H), // will change → row IS rewritten
          },
        ],
      },
    });
    const hosFetcher = async () => ({
      data: [
        { driver: { id: "op1" }, hosLogs: [{ logStartTime: iso(T0), hosStatusType: "driving" }] },
      ],
    });
    await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 10 * H),
      hosFetcher,
    });
    expect(captured.hos_duty_segments![0]!.driver_id).toBe("d1"); // kept, not nulled
  });

  it("fetches the window in ≤7-day chunks and merges before parsing", async () => {
    const calls: [string, string][] = [];
    const hosFetcher = async (s: string, e: string) => {
      calls.push([s, e]);
      return { data: [] };
    };
    const D = 86_400_000;
    await syncHosDutySegments(makeAdmin({ drivers: { data: [] } }).admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 20 * D),
      hosFetcher,
    });
    expect(calls).toEqual([
      [iso(T0), iso(T0 + 7 * D)],
      [iso(T0 + 7 * D), iso(T0 + 14 * D)],
      [iso(T0 + 14 * D), iso(T0 + 20 * D)],
    ]);
  });
});

describe("syncHosDutySegments — logbook vehicle capture (WP-ATTR)", () => {
  it("stores the per-log Samsara vehicle id and resolves it to our vehicle", async () => {
    const { admin, captured } = makeAdmin({
      drivers: { data: [{ id: "d1", samsara_driver_id: "op1" }] },
      vehicles: { data: [{ id: "vA", samsara_vehicle_id: "111" }] }, // 222 intentionally unresolvable
    });
    const hosFetcher = async () => ({
      data: [
        {
          driver: { id: "op1" },
          hosLogs: [
            { logStartTime: iso(T0), hosStatusType: "driving", vehicle: { id: "111" } },
            { logStartTime: iso(T0 + 4 * H), hosStatusType: "driving", vehicle: { id: "222" } },
          ],
        },
      ],
    });
    await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + 10 * H),
      hosFetcher,
    });
    const rows = captured.hos_duty_segments!;
    expect(rows[0]).toMatchObject({ samsara_vehicle_id: "111", vehicle_id: "vA" });
    // Unresolvable vehicle keeps the raw id (a later vehicle link can resolve it) with a null vehicle_id.
    expect(rows[1]).toMatchObject({ samsara_vehicle_id: "222", vehicle_id: null });
  });

  it("a log without a vehicle ref stores nulls (never guessed)", async () => {
    const { admin, captured } = makeAdmin({ drivers: { data: [] } });
    const hosFetcher = async () => ({
      data: [
        { driver: { id: "op1" }, hosLogs: [{ logStartTime: iso(T0), hosStatusType: "offDuty" }] },
      ],
    });
    await syncHosDutySegments(admin, env, "org1", {
      startIso: iso(T0),
      endIso: iso(T0 + H),
      hosFetcher,
    });
    expect(captured.hos_duty_segments![0]).toMatchObject({
      samsara_vehicle_id: null,
      vehicle_id: null,
    });
  });
});
