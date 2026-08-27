import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsLoadInput } from "@fuelguard/shared";
import { ingestLoads } from "./tmsLoadIngest.js";

/**
 * The safety property this whole file exists to protect (D48): **a feed cannot put work on a
 * driver's phone, and cannot overwrite a decision a human already made.**
 *
 * An ingested load lands in `pending_approval`; once dispatch approves it the feed stops writing and
 * starts reporting. Getting this wrong is how a driver ends up at the wrong dock holding paperwork
 * nobody can reconcile — so it is worth pinning down precisely.
 */

interface Captured {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
}

/** Minimal Supabase stand-in that records every write and serves fixed reads. */
function stub(opts: {
  vehicles?: { id: string; unit_number: string }[];
  trailers?: { id: string; unit_number: string }[];
  drivers?: { id: string; employee_id: string | null; mcleod_driver_id?: string | null }[];
  existingLoads?: Record<string, unknown>[];
  autoApprove?: boolean;
}): { admin: SupabaseClient; writes: Captured[] } {
  const writes: Captured[] = [];
  const rowsFor = (table: string): unknown[] => {
    switch (table) {
      case "vehicles": return opts.vehicles ?? [];
      case "trailers": return opts.trailers ?? [];
      case "drivers": return opts.drivers ?? [];
      case "loads": return opts.existingLoads ?? [];
      case "org_integrations": return [{ config: { auto_approve_loads: opts.autoApprove === true } }];
      default: return [];
    }
  };

  const builder = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "not", "order"]) self[m] = () => self;
    self.maybeSingle = () => Promise.resolve({ data: rowsFor(table)[0] ?? null, error: null });
    self.single = () => Promise.resolve({ data: { id: `new-${table}` }, error: null });
    self.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rowsFor(table), error: null });

    self.insert = (payload: unknown) => {
      writes.push({ table, op: "insert", payload });
      const ins: Record<string, unknown> = {
        select: () => ins,
        single: () => Promise.resolve({ data: { id: "new-load" }, error: null }),
        then: (r: (v: { data: null; error: null }) => unknown) => r({ data: null, error: null }),
      };
      return ins;
    };
    self.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload });
      const upd: Record<string, unknown> = {};
      for (const m of ["eq", "in", "is"]) upd[m] = () => upd;
      upd.then = (r: (v: { data: null; error: null }) => unknown) => r({ data: null, error: null });
      return upd;
    };
    self.upsert = (payload: unknown) => {
      writes.push({ table, op: "upsert", payload });
      return { then: (r: (v: { error: null }) => unknown) => r({ error: null }) };
    };
    self.delete = () => {
      const del: Record<string, unknown> = {};
      for (const m of ["eq", "in"]) del[m] = () => del;
      del.then = (r: (v: { error: null }) => unknown) => r({ error: null });
      return del;
    };
    return self;
  };

  return { admin: { from: (t: string) => builder(t) } as unknown as SupabaseClient, writes };
}

function load(over: Partial<TmsLoadInput> = {}): TmsLoadInput {
  return {
    external_id: "MV-1001",
    ref: "LD-20481",
    hazmat: false,
    canceled: false,
    stops: [
      { seq: 1, kind: "pickup", name: "Acme Foods" },
      { seq: 2, kind: "dropoff", name: "Metro DC" },
    ],
    ...over,
  };
}

const loadWrites = (w: Captured[]) => w.filter((x) => x.table === "loads");
const events = (w: Captured[]) =>
  w.filter((x) => x.table === "load_events").map((x) => x.payload as { kind: string; payload: Record<string, unknown> });

describe("a new load from the feed", () => {
  it("lands in pending_approval — never offered", async () => {
    const { admin, writes } = stub({});
    const res = await ingestLoads(admin, "org", "mcleod", [load()]);

    expect(res.created).toBe(1);
    expect(res.results[0]?.outcome).toBe("created");
    const inserted = loadWrites(writes).find((w) => w.op === "insert")?.payload as { status: string; source: string };
    expect(inserted.status).toBe("pending_approval");
    expect(inserted.source).toBe("tms");
  });

  it("gives every stop a photo checklist, so a driver never arrives with nothing to capture", async () => {
    const { admin, writes } = stub({});
    await ingestLoads(admin, "org", "mcleod", [load()]);
    const stops = writes.find((w) => w.table === "load_stops" && w.op === "upsert")?.payload as {
      kind: string; required_photos: string[];
    }[];
    expect(stops).toHaveLength(2);
    expect(stops[0]?.required_photos).toContain("bol");
    expect(stops[1]?.required_photos).toContain("bol");
  });

  it("only auto-approves when the org has opted in", async () => {
    const off = stub({});
    await ingestLoads(off.admin, "org", "mcleod", [load()]);
    expect((loadWrites(off.writes)[0]?.payload as { status: string }).status).toBe("pending_approval");

    const on = stub({ autoApprove: true });
    await ingestLoads(on.admin, "org", "mcleod", [load()]);
    expect((loadWrites(on.writes)[0]?.payload as { status: string }).status).toBe("approved");
    expect(events(on.writes).map((e) => e.kind)).toContain("approved");
  });

  it("reports an unresolved unit instead of dropping the reference", async () => {
    const { admin } = stub({ vehicles: [{ id: "v1", unit_number: "214" }] });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ vehicle_unit: "999" })]);
    expect(res.unmatched).toEqual(["999"]);
  });

  it("resolves a unit number and an employee id to our ids", async () => {
    const { admin, writes } = stub({
      vehicles: [{ id: "v1", unit_number: "214" }],
      drivers: [{ id: "d1", employee_id: "E-77" }],
    });
    const res = await ingestLoads(admin, "org", "mcleod", [
      load({ vehicle_unit: "214", driver_employee_id: "E-77" }),
    ]);
    expect(res.unmatched).toEqual([]);
    const inserted = loadWrites(writes)[0]?.payload as { vehicle_id: string; driver_id: string };
    expect(inserted.vehicle_id).toBe("v1");
    expect(inserted.driver_id).toBe("d1");
  });
});

describe("re-syncing a load the feed still owns", () => {
  it("overwrites freely while it is still pending_approval", async () => {
    const { admin, writes } = stub({
      existingLoads: [{ id: "L1", external_id: "MV-1001", status: "pending_approval", ref: "LD-OLD", hazmat: false, equipment: null, commodity: null, driver_id: null, vehicle_id: null, trailer_id: null }],
    });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ ref: "LD-NEW" })]);
    expect(res.results[0]?.outcome).toBe("updated");
    expect((loadWrites(writes).find((w) => w.op === "update")?.payload as { ref: string }).ref).toBe("LD-NEW");
  });
});

describe("re-syncing a load DISPATCH owns — the safety property", () => {
  const approved = [{
    id: "L1", external_id: "MV-1001", status: "approved", ref: "LD-20481",
    equipment: "Dry van", commodity: "General freight", hazmat: false,
    driver_id: "d1", vehicle_id: "v1", trailer_id: null,
  }];

  it("does NOT write to an approved load — it reports the diff instead", async () => {
    const { admin, writes } = stub({ existingLoads: approved });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ ref: "LD-CHANGED", equipment: "Reefer" })]);

    expect(res.results[0]?.outcome).toBe("amended");
    expect(res.amended).toBe(1);
    // Provenance updates the two external metadata columns, but never dispatch-owned fields or stops.
    const updates = loadWrites(writes).filter((w) => w.op === "update");
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]?.payload as Record<string, unknown>).sort()).toEqual([
      "external_status", "external_synced_at",
    ]);
    expect(writes.filter((w) => w.table === "load_stops")).toHaveLength(0);
  });

  it("names exactly which fields changed, with both sides", async () => {
    const { admin, writes } = stub({ existingLoads: approved });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ ref: "LD-CHANGED", equipment: "Reefer" })]);

    expect(res.results[0]?.changed?.sort()).toEqual(["equipment", "ref"]);
    const amended = events(writes).find((e) => e.kind === "amended");
    expect(amended?.payload.diff).toMatchObject({
      ref: { from: "LD-20481", to: "LD-CHANGED" },
      equipment: { from: "Dry van", to: "Reefer" },
    });
  });

  it("stays quiet when nothing a driver cares about changed", async () => {
    const { admin, writes } = stub({ existingLoads: approved });
    const res = await ingestLoads(admin, "org", "mcleod", [
      load({ equipment: "Dry van", commodity: "General freight", notes: "a new note from the TMS" }),
    ]);
    // `notes` is not in AMENDABLE_LOAD_FIELDS — a note drifting is not worth interrupting dispatch.
    expect(res.results[0]?.outcome).toBe("unchanged");
    expect(events(writes)).toHaveLength(0);
  });
});

describe("cancellation upstream", () => {
  it("cancels a load a driver may already be running, loudly", async () => {
    const { admin, writes } = stub({
      existingLoads: [{ id: "L1", external_id: "MV-1001", status: "in_transit", ref: "LD-20481", hazmat: false, equipment: null, commodity: null, driver_id: "d1", vehicle_id: null, trailer_id: null }],
    });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ canceled: true })]);

    expect(res.canceled).toBe(1);
    const upd = loadWrites(writes).find((w) => w.op === "update")?.payload as { status: string; cancel_reason: string };
    expect(upd.status).toBe("canceled");
    expect(upd.cancel_reason).toContain("TMS");
    // The event records what it interrupted — dispatch needs to know a truck is mid-run.
    expect(events(writes).find((e) => e.kind === "canceled")?.payload.was).toBe("in_transit");
  });

  it("is a no-op for a load that was already canceled or delivered", async () => {
    const { admin, writes } = stub({
      existingLoads: [{ id: "L1", external_id: "MV-1001", status: "delivered", ref: "LD-1", hazmat: false, equipment: null, commodity: null, driver_id: null, vehicle_id: null, trailer_id: null }],
    });
    const res = await ingestLoads(admin, "org", "mcleod", [load({ canceled: true })]);
    expect(res.results[0]?.outcome).toBe("unchanged");
    expect(loadWrites(writes).filter((w) => w.op === "update")).toHaveLength(0);
  });

  it("skips a cancellation for something never ingested rather than inventing a row", async () => {
    const { admin, writes } = stub({});
    const res = await ingestLoads(admin, "org", "mcleod", [load({ canceled: true })]);
    expect(res.results[0]?.outcome).toBe("skipped");
    expect(loadWrites(writes)).toHaveLength(0);
  });
});

describe("batch reporting", () => {
  it("reports an outcome for every load so nothing is silently dropped", async () => {
    const { admin } = stub({});
    const res = await ingestLoads(admin, "org", "mcleod", [
      load({ external_id: "A", ref: "LD-A" }),
      load({ external_id: "B", ref: "LD-B" }),
      load({ external_id: "C", ref: "LD-C", canceled: true }),
    ]);
    expect(res.received).toBe(3);
    expect(res.results).toHaveLength(3);
    expect(res.results.map((r) => r.external_id)).toEqual(["A", "B", "C"]);
  });
});

/**
 * Resolving a McLeod load to the driver and trailer it names (MCLEOD-FIELD-GAP-PLAN F1).
 *
 * Both of these failed silently before D-FG7/D-FG8, and silently is the operative word: the load
 * still landed, with a null driver or a null trailer, and the only trace was an `unmatched` array in
 * a response the agent prints to a log.
 */
describe("a load from McLeod finds the records it names", () => {
  const mcleodDriver = [{ id: "d-1", employee_id: null, mcleod_driver_id: "D0001" }];

  it("resolves the driver by the McLeod id, because employee_id is empty at this carrier", async () => {
    const { admin, writes } = stub({ drivers: mcleodDriver });
    const res = await ingestLoads(admin, "org1", "mcleod", [load({ driver_employee_id: "D0001" })]);
    expect((loadWrites(writes)[0]!.payload as { driver_id: string }).driver_id).toBe("d-1");
    expect(res.results[0]!.outcome).toBe("created");
  });

  it("resolves a reefer whose McLeod unit number lacks Silvicom 360's R prefix", async () => {
    const { admin, writes } = stub({ trailers: [{ id: "t-1", unit_number: "R532159" }] });
    await ingestLoads(admin, "org1", "mcleod", [load({ trailer_unit: "532159" })]);
    expect((loadWrites(writes)[0]!.payload as { trailer_id: string }).trailer_id).toBe("t-1");
  });

  it("still reports a driver nobody holds, rather than inventing one", async () => {
    const { admin, writes } = stub({ drivers: mcleodDriver });
    const res = await ingestLoads(admin, "org1", "mcleod", [load({ driver_employee_id: "D9999" })]);
    expect(res.unmatched).toContain("D9999");
    expect((loadWrites(writes)[0]!.payload as { driver_id: string | null }).driver_id).toBeNull();
  });

  it("leaves a carrier that really uses employee_id working exactly as before", async () => {
    const { admin, writes } = stub({ drivers: [{ id: "d-2", employee_id: "EMP-7" }] });
    await ingestLoads(admin, "org1", "mcleod", [load({ driver_employee_id: "EMP-7" })]);
    expect((loadWrites(writes)[0]!.payload as { driver_id: string }).driver_id).toBe("d-2");
  });
});
