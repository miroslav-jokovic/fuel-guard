/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncHosDutySegments } from "./hosSync.js";
import type { Env } from "../env.js";

/** Same tiny chainable Supabase fake used by idleSync.test — awaiting a node yields the table fixture;
 *  .upsert() captures written rows. */
function makeAdmin(fixtures: Record<string, { data: unknown }>) {
  const captured: Record<string, Record<string, unknown>[]> = {};
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
        return () => proxy;
      },
      apply: () => proxy,
    });
    return proxy;
  }
  return { admin: { from: (t: string) => node(t) } as unknown as SupabaseClient, captured };
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
        { driver: { id: "op1" }, logs: [
          { logStartTime: iso(T0), dutyStatus: "driving" },
          { logStartTime: iso(T0 + 2 * H), dutyStatus: "sleeperBed" },
        ] },
        { driver: { id: "op2" }, logs: [
          { logStartTime: iso(T0 + H), dutyStatus: "onDuty" },
        ] },
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

  it("returns zero and warns when items arrive but nothing parses (shape drift guard)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin, captured } = makeAdmin({ drivers: { data: [] } });
    // A malformed item: no recognizable driver id / logs → 0 segments although data is non-empty.
    const hosFetcher = async () => ({ data: [{ unexpected: true, entries: [{ ts: "x" }] }] });
    const res = await syncHosDutySegments(admin, env, "org1", { hosFetcher, startIso: iso(T0), endIso: iso(T0 + H) });
    expect(res).toEqual({ fetched: 0, upserted: 0 });
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
    expect(res).toEqual({ fetched: 0, upserted: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
