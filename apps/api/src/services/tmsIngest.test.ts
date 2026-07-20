import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestMovements, ingestDriverTimeOff, orgForIngestToken } from "./tmsIngest.js";
import { hashIngestToken } from "../lib/ingestToken.js";

interface Write { table: string; op: "upsert" | "insert"; payload: Record<string, unknown>[] }
type SelectState = { table: string; eq: Record<string, unknown> };

function makeAdmin(resolve: (q: SelectState) => unknown[]) {
  const writes: Write[] = [];
  function selectBuilder(table: string) {
    const eq: Record<string, unknown> = {};
    const b = {
      eq: (k: string, v: unknown) => { eq[k] = v; return b; },
      maybeSingle: async () => ({ data: resolve({ table, eq })[0] ?? null }),
      then: (r: (v: { data: unknown }) => unknown) => Promise.resolve({ data: resolve({ table, eq }) }).then(r),
    };
    return b;
  }
  const admin = {
    from: (table: string) => ({
      select: () => selectBuilder(table),
      upsert: (payload: Record<string, unknown>[]) => { writes.push({ table, op: "upsert", payload }); return Promise.resolve({ error: null }); },
      insert: (payload: Record<string, unknown>[]) => { writes.push({ table, op: "insert", payload }); return Promise.resolve({ error: null }); },
    }),
  } as unknown as SupabaseClient;
  return { admin, writes };
}

describe("tms ingest", () => {
  it("resolves units, flags reefer loads, and reports unmatched vehicles", async () => {
    const { admin, writes } = makeAdmin((q) => {
      if (q.table === "vehicles") return [{ id: "v1", unit_number: "T-104" }];
      if (q.table === "trailers") return [{ id: "r1", unit_number: "R-22" }];
      return [];
    });
    const res = await ingestMovements(admin, "org1", "mcleod", [
      { external_id: "M1", vehicle_unit: "T-104", trailer_unit: "R-22", temperature_controlled: true, started_at: "2026-07-01T00:00:00Z" },
      { external_id: "M2", vehicle_unit: "T-999", temperature_controlled: false },
    ]);
    expect(res.received).toBe(2);
    const rows = writes.find((w) => w.table === "tms_movements")!.payload;
    expect(rows[0]!.vehicle_id).toBe("v1");
    expect(rows[0]!.trailer_id).toBe("r1");
    expect(rows[0]!.temperature_controlled).toBe(true);
    expect(rows[0]!.org_id).toBe("org1");
    expect(rows[1]!.vehicle_id).toBeNull(); // T-999 not in the fleet
    expect(res.unmatched).toContain("T-999");
  });

  it("resolves a token by HASH (never plaintext) to its org, and rejects unknown/empty tokens", async () => {
    const { admin } = makeAdmin((q) =>
      q.table === "org_integrations" && q.eq.ingest_token_hash === hashIngestToken("tok")
        ? [{ org_id: "org1", provider: "mcleod", enabled: true }]
        : [],
    );
    expect(await orgForIngestToken(admin, "tok")).toEqual({ orgId: "org1", provider: "mcleod" });
    expect(await orgForIngestToken(admin, "bad")).toBeNull();
    expect(await orgForIngestToken(admin, "")).toBeNull(); // empty short-circuits, never hits the DB
  });

  it("upserts driver time-off, matching drivers by employee id", async () => {
    const { admin, writes } = makeAdmin((q) =>
      q.table === "drivers" ? [{ id: "d1", employee_id: "E1", samsara_driver_id: null }] : [],
    );
    const res = await ingestDriverTimeOff(admin, "org1", "mcleod", [
      { external_id: "W1", driver_employee_id: "E1", start_at: "2026-07-01T00:00:00Z", kind: "home_time" },
      { external_id: "W2", driver_employee_id: "E9", start_at: "2026-07-02T00:00:00Z", kind: "home_time" },
    ]);
    const rows = writes.find((w) => w.table === "driver_time_off" && w.op === "upsert")!.payload;
    expect(rows[0]!.driver_id).toBe("d1");
    expect(rows[1]!.driver_id).toBeNull(); // E9 unknown
    expect(res.unmatched).toContain("E9");
  });
});
