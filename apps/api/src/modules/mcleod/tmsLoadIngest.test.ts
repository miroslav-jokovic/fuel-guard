import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsLoadInput } from "@silvicom/shared";
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
      const rows = (Array.isArray(payload) ? payload : [payload]) as { external_id?: string }[];
      const returned = rows.map((r, i) => ({ id: `new-load-${i}`, external_id: r.external_id }));
      const ins: Record<string, unknown> = {
        select: () => ins,
        single: () => Promise.resolve({ data: returned[0] ?? { id: "new-load" }, error: null }),
        // REVERSED on purpose. PostgREST does not promise the returned rows come back in the order
        // they were sent, so the ingest must pair them by external_id; returning them in order would
        // let a positional bug pass. Mutating the pairing to use position fails the suite.
        then: (r: (v: { data: unknown[]; error: null }) => unknown) =>
          r({ data: [...returned].reverse(), error: null }),
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
/** The rows of the first `loads` insert. Batched since L11, so the payload is an array of rows. */
const insertedLoads = (w: Captured[]): Record<string, unknown>[] => {
  const p = loadWrites(w).find((x) => x.op === "insert")?.payload;
  return (Array.isArray(p) ? p : p ? [p] : []) as Record<string, unknown>[];
};
const events = (w: Captured[]) =>
  w
    .filter((x) => x.table === "load_events")
    .flatMap((x) => (Array.isArray(x.payload) ? x.payload : [x.payload])) as {
    kind: string;
    payload: Record<string, unknown>;
  }[];

describe("a new load from the feed", () => {
  it("lands in pending_approval — never offered", async () => {
    const { admin, writes } = stub({});
    const res = await ingestLoads(admin, "org", "mcleod", [load()]);

    expect(res.created).toBe(1);
    expect(res.results[0]?.outcome).toBe("created");
    const inserted = insertedLoads(writes)[0] as unknown as { status: string; source: string };
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
    expect(insertedLoads(off.writes)[0]?.status).toBe("pending_approval");

    const on = stub({ autoApprove: true });
    await ingestLoads(on.admin, "org", "mcleod", [load()]);
    expect(insertedLoads(on.writes)[0]?.status).toBe("approved");
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
    const inserted = insertedLoads(writes)[0] as unknown as { vehicle_id: string; driver_id: string };
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
    expect(insertedLoads(writes)[0]?.driver_id).toBe("d-1");
    expect(res.results[0]!.outcome).toBe("created");
  });

  it("resolves a reefer whose McLeod unit number lacks Silvicom 360's R prefix", async () => {
    const { admin, writes } = stub({ trailers: [{ id: "t-1", unit_number: "R532159" }] });
    await ingestLoads(admin, "org1", "mcleod", [load({ trailer_unit: "532159" })]);
    expect(insertedLoads(writes)[0]?.trailer_id).toBe("t-1");
  });

  it("still reports a driver nobody holds, rather than inventing one", async () => {
    const { admin, writes } = stub({ drivers: mcleodDriver });
    const res = await ingestLoads(admin, "org1", "mcleod", [load({ driver_employee_id: "D9999" })]);
    expect(res.unmatched).toContain("D9999");
    expect(insertedLoads(writes)[0]?.driver_id).toBeNull();
  });

  it("leaves a carrier that really uses employee_id working exactly as before", async () => {
    const { admin, writes } = stub({ drivers: [{ id: "d-2", employee_id: "EMP-7" }] });
    await ingestLoads(admin, "org1", "mcleod", [load({ driver_employee_id: "EMP-7" })]);
    expect(insertedLoads(writes)[0]?.driver_id).toBe("d-2");
  });
});

/**
 * D-LM12. McLeod at this carrier does not know whether a load is hazmat — `orders.hazmat = 'Y'` on
 * 1 of 134,996 rows — so our own rules engine decides it. `hazmat` is in `AMENDABLE_LOAD_FIELDS`
 * and the feed may overwrite freely before approval, so the schema's old `.default(false)` turned
 * every silent poll into an assertion that erased that decision.
 */
describe("hazmat, which the feed does not know", () => {
  it("omits hazmat from the insert when the feed did not send it, so the column default applies", async () => {
    const { admin, writes } = stub({});
    const { hazmat: _absent, ...withoutHazmat } = load();
    await ingestLoads(admin, "org", "mcleod", [withoutHazmat as TmsLoadInput]);
    const inserted = insertedLoads(writes)[0]!;
    // Present-but-null would fail the NOT NULL constraint; the key must be absent entirely.
    expect(Object.hasOwn(inserted, "hazmat")).toBe(false);
  });

  it("does not erase a hazmat load our engine flagged, when the feed says nothing", async () => {
    const { admin, writes } = stub({
      existingLoads: [{ id: "L1", external_id: "MV-1001", status: "pending_approval", ref: "LD-20481", hazmat: true, equipment: null, commodity: null, driver_id: null, vehicle_id: null, trailer_id: null }],
    });
    const { hazmat: _absent, ...withoutHazmat } = load();
    await ingestLoads(admin, "org", "mcleod", [withoutHazmat as TmsLoadInput]);
    const patch = loadWrites(writes).find((w) => w.op === "update")?.payload as Record<string, unknown>;
    expect(Object.hasOwn(patch, "hazmat")).toBe(false);
  });

  it("still writes hazmat when a feed genuinely asserts it", async () => {
    const { admin, writes } = stub({});
    await ingestLoads(admin, "org", "mcleod", [load({ hazmat: true })]);
    const inserted = insertedLoads(writes)[0] as unknown as { hazmat: unknown };
    expect(inserted.hazmat).toBe(true);
  });

  it("does not raise an amendment on an approved load merely because the feed omitted hazmat", async () => {
    const { admin, writes } = stub({
      existingLoads: [{ id: "L1", external_id: "MV-1001", status: "approved", ref: "LD-20481", hazmat: true, equipment: null, commodity: null, driver_id: null, vehicle_id: null, trailer_id: null }],
    });
    const { hazmat: _absent, ...withoutHazmat } = load();
    const res = await ingestLoads(admin, "org", "mcleod", [withoutHazmat as TmsLoadInput]);
    expect(res.results[0]?.outcome).toBe("unchanged");
    expect(events(writes).filter((e) => e.kind === "amended")).toHaveLength(0);
  });
});

/**
 * The hazard L11 introduced, pinned (LOADS-GO-LIVE-PLAN L11).
 *
 * Batching means one statement now carries many loads, and the whole safety property of this file is
 * that SOME of those loads belong to dispatch and must not be written. A bulk write that decided
 * ownership as it went — or that swept a whole board into one upsert — would silently overwrite work
 * an office had already approved, and it would do it fastest of all.
 *
 * So ownership is decided for every load BEFORE any statement is issued, and this proves a mixed
 * batch keeps them apart.
 */
describe("a batch holding both kinds of load — the property batching could have broken", () => {
  const mixed = [
    { id: "L-own", external_id: "MV-OWN", status: "pending_approval", ref: "LD-OWN-OLD", hazmat: false, equipment: null, commodity: null, driver_id: null, vehicle_id: null, trailer_id: null },
    { id: "L-dispatch", external_id: "MV-DISPATCH", status: "approved", ref: "LD-DISPATCH", hazmat: false, equipment: "Dry van", commodity: null, driver_id: null, vehicle_id: null, trailer_id: null },
  ];

  it("writes the feed's load and leaves the approved one alone, in the same batch", async () => {
    const { admin, writes } = stub({ existingLoads: mixed });
    const res = await ingestLoads(admin, "org", "mcleod", [
      load({ external_id: "MV-OWN", ref: "LD-OWN-NEW" }),
      load({ external_id: "MV-DISPATCH", ref: "LD-DISPATCH-CHANGED", equipment: "Reefer" }),
      load({ external_id: "MV-NEW", ref: "LD-BRAND-NEW" }),
    ]);

    expect(res.results.map((r) => r.outcome)).toEqual(["updated", "amended", "created"]);

    // The approved load's id must never appear in a statement that changes dispatch-owned fields.
    const touchedDispatchFields = loadWrites(writes).filter((w) => {
      const rows = (Array.isArray(w.payload) ? w.payload : [w.payload]) as Record<string, unknown>[];
      return rows.some((r) => Object.hasOwn(r, "ref") || Object.hasOwn(r, "equipment"));
    });
    for (const w of touchedDispatchFields) {
      const rows = (Array.isArray(w.payload) ? w.payload : [w.payload]) as Record<string, unknown>[];
      expect(rows.every((r) => r.ref !== "LD-DISPATCH-CHANGED" && r.equipment !== "Reefer")).toBe(true);
    }

    // And its stops are never replaced — a stop a driver has worked is evidence.
    const stopRows = writes
      .filter((w) => w.table === "load_stops" && w.op === "upsert")
      .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as { load_id: string }[]);
    expect(stopRows.some((r) => r.load_id === "L-dispatch")).toBe(false);
    expect(stopRows.some((r) => r.load_id === "L-own")).toBe(true);
  });

  it("keeps the reported order the feed sent, however the writes were grouped", async () => {
    const { admin } = stub({ existingLoads: mixed });
    const res = await ingestLoads(admin, "org", "mcleod", [
      load({ external_id: "MV-NEW-1", ref: "LD-1" }),
      load({ external_id: "MV-DISPATCH", ref: "LD-DISPATCH" }),
      load({ external_id: "MV-NEW-2", ref: "LD-2" }),
    ]);
    expect(res.results.map((r) => r.external_id)).toEqual(["MV-NEW-1", "MV-DISPATCH", "MV-NEW-2"]);
  });
});

/**
 * The bug that would attach one load's stops to a different load.
 *
 * A batched insert returns the created rows, but PostgREST does not promise them in the order they
 * were sent — so the ingest pairs them back by `external_id`. Pairing by POSITION looks identical on
 * any fixture where the loads are interchangeable, which is why this one deliberately is not: the
 * two loads carry different stops, and the stub returns the inserted rows reversed.
 *
 * Without this test a positional pairing passes the whole suite (measured 2026-09-17: 23/23 green
 * with the mutation in place).
 */
describe("a batch of new loads keeps each load's own stops", () => {
  it("attaches every stop to the load that sent it, whatever order the insert returned", async () => {
    const { admin, writes } = stub({});
    await ingestLoads(admin, "org", "mcleod", [
      load({ external_id: "MV-A", ref: "LD-A", stops: [{ seq: 1, kind: "pickup", name: "A-ONLY" }] }),
      load({ external_id: "MV-B", ref: "LD-B", stops: [{ seq: 1, kind: "pickup", name: "B-ONLY" }] }),
    ]);

    // The stub names ids by the position they were SENT in, so MV-A is new-load-0 by construction.
    const stopRows = writes
      .filter((w) => w.table === "load_stops" && w.op === "upsert")
      .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as { load_id: string; name: string }[]);

    expect(stopRows.find((r) => r.name === "A-ONLY")?.load_id).toBe("new-load-0");
    expect(stopRows.find((r) => r.name === "B-ONLY")?.load_id).toBe("new-load-1");
  });
});
