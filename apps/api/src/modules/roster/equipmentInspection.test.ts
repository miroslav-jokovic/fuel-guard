import { describe, expect, it } from "vitest";
import {
  getEquipmentIdentities,
  getEquipmentIdentity,
  listEquipmentIdentities,
  type EquipmentIdentity,
} from "./equipmentInspection.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * The equipment readers roster exposes to `maintenance` (D-ARC3, D-AVI9).
 *
 * These run with the SERVICE ROLE, which bypasses RLS, so `.eq("org_id", …)` is the only thing
 * standing between one carrier's fleet and another's. Every case asserts it with `expectOrgScoped`
 * rather than trusting the query to have been written correctly.
 */
const ORG = "org1";

const trailerRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "t1",
  unit_number: "T-104",
  vin: "1UYVS2537YU123456",
  plate: null,
  is_reefer: false,
  trailer_type: null,
  ...over,
});

const vehicleRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "v1",
  unit_number: "654",
  vin: "1FUJGLDR5CLBP8834",
  plate: "AB-1234",
  ...over,
});

const asList = (r: EquipmentIdentity[] | { error: string }): EquipmentIdentity[] => {
  if (!Array.isArray(r)) throw new Error(`expected rows, got ${JSON.stringify(r)}`);
  return r;
};

describe("getEquipmentIdentity — one row", () => {
  it("reports a reefer trailer's flag and type", async () => {
    const rec = createSupabaseRecorder({
      tables: { trailers: [trailerRow({ is_reefer: true, trailer_type: "reefer" })] },
    });
    const r = await getEquipmentIdentity(rec.client, ORG, "trailer", "t1");
    expect(r).toMatchObject({ unitNumber: "T-104", isReefer: true, trailerType: "reefer" });
    expectOrgScoped(rec, ORG);
  });

  it("leaves both trailer facts null for a tractor, where the question does not apply", async () => {
    const rec = createSupabaseRecorder({ tables: { vehicles: [vehicleRow()] } });
    const r = await getEquipmentIdentity(rec.client, ORG, "tractor", "v1");
    expect(r).toMatchObject({ unitNumber: "654", isReefer: null, trailerType: null });
    expectOrgScoped(rec, ORG);
  });
});

describe("getEquipmentIdentities — a page of ids", () => {
  it("reports each trailer's own reefer flag instead of a blanket null", async () => {
    // It hardcoded `isReefer: null` until 2026-09-08. Nothing was broken by it — inspectionList
    // reads unit numbers — but the field's meaning differed from the single-row reader's, and
    // D-INV12's reefer kits are the caller that would have believed it.
    const rec = createSupabaseRecorder({
      tables: {
        trailers: [
          trailerRow({ id: "t1", is_reefer: true, trailer_type: "reefer" }),
          trailerRow({ id: "t2", unit_number: "T-105", is_reefer: false, trailer_type: "dry_van" }),
        ],
      },
    });
    const r = await getEquipmentIdentities(rec.client, ORG, "trailer", ["t1", "t2"]);
    if (r instanceof Map) {
      expect(r.get("t1")).toMatchObject({ isReefer: true, trailerType: "reefer" });
      expect(r.get("t2")).toMatchObject({ isReefer: false, trailerType: "dry_van" });
    } else {
      throw new Error("expected a map");
    }
    expectOrgScoped(rec, ORG);
  });

  it("asks the database for nothing when given no ids", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [trailerRow()] } });
    await getEquipmentIdentities(rec.client, ORG, "trailer", []);
    expect(rec.queries).toHaveLength(0);
  });
});

describe("listEquipmentIdentities", () => {
  it("lists every active trailer, org-scoped", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        trailers: [
          trailerRow({ id: "t1", is_reefer: true, trailer_type: "reefer" }),
          trailerRow({ id: "t2", unit_number: "T-105" }),
        ],
      },
    });
    const rows = asList(await listEquipmentIdentities(rec.client, ORG, "trailer"));
    expect(rows.map((r) => r.unitNumber)).toEqual(["T-104", "T-105"]);
    expect(rows[0]).toMatchObject({ isReefer: true, trailerType: "reefer" });
    expect(rows[1]).toMatchObject({ isReefer: false, trailerType: null });
    expectOrgScoped(rec, ORG);
  });

  it("filters to active by DEFAULT, so a retired unit never invents phantom work", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [trailerRow()] } });
    await listEquipmentIdentities(rec.client, ORG, "trailer");
    const filters = rec.forTable("trailers")[0]!.filters();
    expect(filters).toContainEqual(expect.objectContaining({ col: "status", val: "active" }));
  });

  it("drops the status filter only when asked explicitly", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [trailerRow()] } });
    await listEquipmentIdentities(rec.client, ORG, "trailer", { activeOnly: false });
    const filters = rec.forTable("trailers")[0]!.filters();
    expect(filters.some((f) => f.col === "status")).toBe(false);
    expectOrgScoped(rec, ORG);
  });

  it("reads vehicles for a tractor and never touches trailers", async () => {
    const rec = createSupabaseRecorder({
      tables: { vehicles: [vehicleRow()], trailers: [trailerRow()] },
    });
    const rows = asList(await listEquipmentIdentities(rec.client, ORG, "tractor"));
    expect(rows).toEqual([
      { id: "v1", unitNumber: "654", vin: "1FUJGLDR5CLBP8834", plate: "AB-1234", isReefer: null, trailerType: null },
    ]);
    expect(rec.forTable("trailers")).toHaveLength(0);
    expectOrgScoped(rec, ORG);
  });

  it("orders the query, because .range() without a stable sort duplicates and drops rows", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [trailerRow()] } });
    await listEquipmentIdentities(rec.client, ORG, "trailer");
    const ops = rec.forTable("trailers")[0]!.ops.filter((o) => o.method === "order");
    expect(ops.map((o) => o.args[0])).toEqual(["unit_number", "id"]);
  });

  it("pages past the PostgREST cap instead of silently truncating", async () => {
    // The recorder drains `pages` on successive reads, so this drives the real .range() loop.
    const full = Array.from({ length: 1000 }, (_, i) =>
      trailerRow({ id: `t${i}`, unit_number: `T-${i}` }),
    );
    const rec = createSupabaseRecorder({
      tables: { trailers: { pages: [full, [trailerRow({ id: "last", unit_number: "T-last" })]] } },
    });
    const rows = asList(await listEquipmentIdentities(rec.client, ORG, "trailer"));
    expect(rows).toHaveLength(1001);
    expect(rows.at(-1)?.unitNumber).toBe("T-last");
    expect(rec.forTable("trailers")).toHaveLength(2); // it asked for a second page
  });

  it("stops after one page when the first comes back short", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [trailerRow()] } });
    await listEquipmentIdentities(rec.client, ORG, "trailer");
    expect(rec.forTable("trailers")).toHaveLength(1);
  });

  it("returns an empty list, not an error, for a fleet with no equipment", async () => {
    const rec = createSupabaseRecorder({ tables: { trailers: [] } });
    expect(asList(await listEquipmentIdentities(rec.client, ORG, "trailer"))).toEqual([]);
  });

  it("answers in EquipmentError rather than throwing when a page fails", async () => {
    const rec = createSupabaseRecorder({
      tables: { trailers: { data: null, error: { message: "connection reset" } } },
    });
    const r = await listEquipmentIdentities(rec.client, ORG, "trailer");
    expect(r).toEqual({ error: "Could not list the equipment records", code: "db_error" });
  });
});
