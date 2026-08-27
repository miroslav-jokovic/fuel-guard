import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { resolveFuelTransactionStations } from "./fuelStationResolve.js";

/**
 * Pointing fills at stations. The matching rules are pure and tested in
 * `packages/shared/src/fuelSpend/stationMatch.test.ts`; what only exists here is the I/O around them —
 * the tenant filter, the "only what is still unresolved" default that keeps the nightly sweep cheap,
 * and the write shape, which must be an UPDATE and never an upsert on the primary key.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const STATIONS = [
  { id: "fj-305", brand: "flying_j", store_number: "305", state: "NM" },
  { id: "pilot-436", brand: "pilot", store_number: "436", state: "TX" },
];

const fill = (id: string, location_text: string | null, state: string | null) => ({ id, location_text, state });

function seed(fills: unknown[] = []): SupabaseRecorder {
  return createSupabaseRecorder({ tables: { fuel_stations: STATIONS, fuel_transactions: fills } });
}

describe("resolveFuelTransactionStations", () => {
  it("scopes every fuel_transactions query to one org, reads and writes alike", async () => {
    const rec = seed([fill("f1", "PILOT JAMESTOWN 305 JAMESTOWN NM", "NM")]);
    await resolveFuelTransactionStations(rec.client, ORG);
    // fuel_stations is GLOBAL reference data and is deliberately not org-scoped.
    expectOrgScoped(rec, ORG, { exempt: ["fuel_stations"] });
  });

  it("only looks at fills with no station yet, so the nightly sweep stays cheap", async () => {
    const rec = seed([fill("f1", "PILOT AMARILLO 436 AMARILLO TX", "TX")]);
    await resolveFuelTransactionStations(rec.client, ORG);
    const read = rec.forTable("fuel_transactions").find((q) => !q.write)!;
    expect(read.ops.some((o) => o.method === "is" && o.args[0] === "station_id" && o.args[1] === null)).toBe(true);
  });

  it("re-resolves everything when asked, so a matcher fix can be applied to history", async () => {
    const rec = seed([fill("f1", "PILOT AMARILLO 436 AMARILLO TX", "TX")]);
    await resolveFuelTransactionStations(rec.client, ORG, { onlyUnresolved: false });
    const read = rec.forTable("fuel_transactions").find((q) => !q.write)!;
    expect(read.ops.some((o) => o.method === "is" && o.args[0] === "station_id")).toBe(false);
  });

  it("writes with UPDATE, never an upsert keyed on the primary key", async () => {
    const rec = seed([fill("f1", "PILOT AMARILLO 436 AMARILLO TX", "TX")]);
    await resolveFuelTransactionStations(rec.client, ORG);
    const write = rec.forTable("fuel_transactions").find((q) => q.write)!;
    expect(write.write?.method).toBe("update");
    expect(write.write?.payload).toEqual({ station_id: "pilot-436" });
    expect(write.ops.some((o) => o.method === "in" && o.args[0] === "id")).toBe(true);
  });

  it("groups fills by station so tens of thousands of them cost a few hundred statements", async () => {
    const rec = seed([
      fill("f1", "PILOT AMARILLO 436 AMARILLO TX", "TX"),
      fill("f2", "PILOT AMARILLO 436 AMARILLO TX", "TX"),
      fill("f3", "PILOT JAMESTOWN 305 JAMESTOWN NM", "NM"),
    ]);
    const r = await resolveFuelTransactionStations(rec.client, ORG);
    expect(r.resolved).toBe(3);
    expect(r.updates).toBe(2); // two stations, not three fills
  });

  it("counts every outcome, including the fills that legitimately do not resolve", async () => {
    const rec = seed([
      fill("f1", "PILOT JAMESTOWN 305 JAMESTOWN NM", "NM"), // family
      fill("f2", "MONROE MART MONROE MI", "MI"), // an independent
      fill("f3", "PILOT TOWN PUMP BILLINGS, BILLINGS, MT", "MT"), // branded, no number
      fill("f4", "PILOT 9999 NOWHERE NM", "NM"), // no such store
    ]);
    const r = await resolveFuelTransactionStations(rec.client, ORG);
    expect(r.scanned).toBe(4);
    expect(r.resolved).toBe(1);
    expect(r.byReason).toMatchObject({ family: 1, no_brand: 1, no_store: 1, unmatched: 1 });
    // The missing key is reported so the registry gap is closeable rather than invisible.
    expect(r.topUnmatched[0]?.key).toContain("9999");
  });

  it("writes nothing at all when nothing resolves", async () => {
    const rec = seed([fill("f1", "MONROE MART MONROE MI", "MI")]);
    const r = await resolveFuelTransactionStations(rec.client, ORG);
    expect(r.updates).toBe(0);
    expect(rec.forTable("fuel_transactions").some((q) => q.write)).toBe(false);
  });

  it("surfaces a write failure instead of reporting fills it did not actually point anywhere", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        fuel_stations: STATIONS,
        fuel_transactions: (q) =>
          q.write ? { data: [], writeError: { message: "deadlock detected" } } : { data: [fill("f1", "PILOT AMARILLO 436 AMARILLO TX", "TX")] },
      },
    });
    await expect(resolveFuelTransactionStations(rec.client, ORG)).rejects.toThrow(/deadlock detected/);
  });
});
