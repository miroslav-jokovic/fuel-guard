import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestMovements, ingestDriverTimeOff, orgForIngestToken, syntheticTimeOffId } from "./tmsIngest.js";
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

  it("P1: a window WITHOUT an external_id gets a deterministic synthetic identity and is UPSERTED, never appended", async () => {
    // The old path plain-INSERTED id-less windows — every re-ingest of the same feed duplicated
    // them, and duplicated home-time windows fed fuel_while_driver_home. Now every row carries an
    // idempotency key: the provider id, or a content-derived synthetic one.
    const { admin, writes } = makeAdmin((q) =>
      q.table === "drivers" ? [{ id: "d1", employee_id: "E1", samsara_driver_id: null }] : [],
    );
    await ingestDriverTimeOff(admin, "org1", "mcleod", [
      { driver_employee_id: "E1", start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-03T00:00:00Z", kind: "home_time" },
      { driver_employee_id: "E1", start_at: "2026-07-10T00:00:00Z", kind: "home_time" }, // open-ended
    ]);
    expect(writes.every((w) => w.op === "upsert")).toBe(true); // NO plain inserts remain
    const rows = writes.find((w) => w.table === "driver_time_off")!.payload;
    expect(rows[0]!.external_id).toBe(syntheticTimeOffId("d1", "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z", "home_time"));
    expect(rows[1]!.external_id).toBe(syntheticTimeOffId("d1", "2026-07-10T00:00:00Z", null, "home_time"));
    // Deterministic + epoch-based: byte-identical to the SQL backfill in migration 0125.
    expect(rows[0]!.external_id).toBe("synthetic:d1:1782864000:1783036800:home_time");
    expect(rows[1]!.external_id).toBe("synthetic:d1:1783641600:open:home_time");
  });
});

/**
 * Resolving what a McLeod movement or time-off window names (MCLEOD-FIELD-GAP-PLAN F1).
 *
 * The movement feed exists to answer one question — was this a temperature-controlled movement — and
 * it answers it from the TRAILER. So a trailer that fails to resolve is not a cosmetic gap: it is the
 * feed silently failing at its only job, on precisely the ~44 reefers whose unit numbers differ by
 * Silvicom 360's `R` prefix (D-FG8).
 */
describe("a McLeod movement finds the records it names", () => {
  it("resolves a reefer whose McLeod unit number lacks Silvicom 360's R prefix", async () => {
    const { admin, writes } = makeAdmin((q) => {
      if (q.table === "vehicles") return [{ id: "v1", unit_number: "104" }];
      if (q.table === "trailers") return [{ id: "t1", unit_number: "R532159" }];
      return [];
    });
    await ingestMovements(admin, "org1", "mcleod", [
      { external_id: "M1", vehicle_unit: "104", trailer_unit: "532159", temperature_controlled: true },
    ]);
    const rows = writes.find((w) => w.table === "tms_movements")!.payload;
    expect(rows[0]!.trailer_id).toBe("t1");
  });

  it("REPORTS a trailer it cannot place instead of quietly writing null", async () => {
    // Before F1 an unresolvable trailer produced a null and appeared in no report at all, so a
    // mis-prefixed fleet looked exactly like a fleet with no reefers.
    const { admin, writes } = makeAdmin((q) => (q.table === "trailers" ? [{ id: "t1", unit_number: "R1" }] : []));
    const res = await ingestMovements(admin, "org1", "mcleod", [
      { external_id: "M1", trailer_unit: "NOPE", temperature_controlled: true },
    ]);
    expect(res.unmatched).toContain("NOPE");
    expect((writes.find((w) => w.table === "tms_movements")!.payload)[0]!.trailer_id).toBeNull();
  });
});

describe("a McLeod time-off window finds its driver", () => {
  it("resolves by the McLeod driver id, because employee_id is empty at this carrier", async () => {
    const { admin, writes } = makeAdmin((q) =>
      q.table === "drivers" ? [{ id: "d1", employee_id: null, mcleod_driver_id: "D0001", samsara_driver_id: null }] : [],
    );
    await ingestDriverTimeOff(admin, "org1", "mcleod", [
      { driver_employee_id: "D0001", start_at: "2026-08-01T00:00:00Z", kind: "home_time" },
    ]);
    const rows = writes.find((w) => w.table === "driver_time_off")!.payload;
    expect(rows[0]!.driver_id).toBe("d1");
  });

  it("still resolves the Samsara id, which is the key that worked before", async () => {
    const { admin, writes } = makeAdmin((q) =>
      q.table === "drivers" ? [{ id: "d2", employee_id: null, mcleod_driver_id: null, samsara_driver_id: "S9" }] : [],
    );
    await ingestDriverTimeOff(admin, "org1", "mcleod", [
      { driver_samsara_id: "S9", start_at: "2026-08-01T00:00:00Z", kind: "home_time" },
    ]);
    expect((writes.find((w) => w.table === "driver_time_off")!.payload)[0]!.driver_id).toBe("d2");
  });
});
