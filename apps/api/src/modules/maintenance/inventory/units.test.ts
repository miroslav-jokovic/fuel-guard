import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The units service (INVENTORY-PLAN.md step I9).
 *
 * ── WHAT THIS LAYER CAN GET WRONG THAT NOTHING ELSE WOULD CATCH ───────────────────────────────
 * 0333's matrix owns the database's promises and `deriveKitStatus` has its own tests in shared. What
 * is only true here is the RESOLUTION — which of three layers supplies each number, and whether the
 * answer this file hands to a screen is the same one `move_asset` would give:
 *
 *   · **the three layers resolve per-unit → fleet → type, in that order.** It is `move_asset`'s own
 *     order, and a kit screen resolving it differently would tell a technician a truck may hold two
 *     of something the database will refuse to give it a second of;
 *   · **a reefer resolves the reefer kit.** `unitKindOf` draws that line above the database and SQL
 *     draws it again below; a units read that called every trailer a `trailer` would disagree with
 *     `IV020` about the same trailer and each would look right on its own;
 *   · **kit status is `deriveKitStatus`'s answer, carried**, not arithmetic done again here;
 *   · **the org filter**, because the service role bypasses RLS;
 *   · **the driver is resolved for one unit and not for a list of 440.**
 *
 * ⚠ Fixtures are FUNCTIONS. `supabaseRecorder` records `.eq()` and does not apply it, so a flat
 * array answers "the trailers" with the tractors too — and every assertion about kinds would pass
 * against a service that never sent a filter.
 */

const ORG = "org-1";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const DRYVAN = "22222222-2222-4222-8222-222222222222";
const REEFER = "33333333-3333-4333-8333-333333333333";
const TABLET = "44444444-4444-4444-8444-444444444444";
const BAR = "55555555-5555-4555-8555-555555555555";
const CABLE = "66666666-6666-4666-8666-666666666666";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { listUnitKits, getUnitKit, resolveExpected } = await import("./units.js");
type ExpectationRow = Parameters<typeof resolveExpected>[1][number];

const TYPES = [
  { id: TABLET, name: "Tablet", default_kit_quantity: 1 },
  { id: BAR, name: "Load bar", default_kit_quantity: 2 },
  { id: CABLE, name: "Reefer cable", default_kit_quantity: 0 },
];

/** Rows shaped as the roster's tables, because `listEquipmentIdentities` reads them directly. */
const vehicles = [{ id: TRUCK, unit_number: "654", vin: null, plate: null }];
const trailers = [
  { id: DRYVAN, unit_number: "T-4102", vin: null, plate: null, is_reefer: false, trailer_type: "dry_van" },
  { id: REEFER, unit_number: "R-8800", vin: null, plate: null, is_reefer: true, trailer_type: "reefer" },
];

const expectation = (over: Partial<ExpectationRow> = {}): ExpectationRow => ({
  asset_type_id: BAR,
  unit_kind: "trailer",
  vehicle_id: null,
  trailer_id: null,
  quantity: 2,
  asset_types: { name: "Load bar", default_kit_quantity: 2 },
  ...over,
});

/**
 * A held asset. Fuller than the units read needs, because `getUnitKit` builds real `AssetDto`s
 * through `listAssets` — and `nextDisplayNo` throws on a missing `display_seq`, which is the shape
 * of fixture defect that otherwise reads as a service bug.
 */
let seq = 0;
const held = (assetTypeId: string, unit: { vehicle?: string; trailer?: string }, id = `as-${++seq}`) => ({
  id,
  tag_code: null,
  display_seq: seq,
  asset_type_id: assetTypeId,
  name: "A thing",
  serial_number: null,
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  location_id: null,
  vehicle_id: unit.vehicle ?? null,
  trailer_id: unit.trailer ?? null,
  purchased_at: null,
  purchase_cost: null,
  warranty_expires_at: null,
  image_path: null,
  notes: null,
  asset_types: { name: "A kind" },
  stock_locations: null,
  vehicles: null,
  trailers: null,
});

const SCOPED = { exempt: ["user_profiles"] };

/** Answers each table on the filters the service actually sent. */
const recorder = (opts: { expectations?: unknown[]; held?: unknown[] } = {}) =>
  createSupabaseRecorder({
    tables: {
      vehicles: () => vehicles,
      trailers: () => trailers,
      asset_types: () => TYPES,
      kit_expectations: () => opts.expectations ?? [],
      inventory_assets: (q) => {
        const rows = (opts.held ?? []) as Array<Record<string, unknown>>;
        const notNull = q
          .ops.filter((o) => o.method === "not")
          .map((o) => String(o.args[0]));
        return rows.filter((r) => notNull.every((col) => r[col] !== null));
      },
      drivers: () => [],
    },
  });

beforeEach(() => {
  rec = recorder();
});

describe("resolving what a unit should hold", () => {
  const rows = [
    expectation(),                                                   // fleet: every trailer, 2 bars
    expectation({ trailer_id: DRYVAN, quantity: 1 }),                // this trailer: 1 bar
    expectation({ asset_type_id: CABLE, unit_kind: "reefer_trailer", quantity: 1, asset_types: { name: "Reefer cable", default_kit_quantity: 0 } }),
  ];
  const defaults = new Map(TYPES.map((t) => [t.id, { name: t.name, quantity: t.default_kit_quantity }]));

  it("lets a per-unit override beat the fleet default, which beats the type's own", () => {
    const forDryVan = resolveExpected({ kind: "trailer", unitId: DRYVAN }, rows, defaults);
    const bar = forDryVan.find((l) => l.assetTypeId === BAR);
    expect(bar).toMatchObject({ quantity: 1, source: "unit" });

    const forOther = resolveExpected({ kind: "trailer", unitId: REEFER }, rows, defaults);
    expect(forOther.find((l) => l.assetTypeId === BAR)).toMatchObject({ quantity: 2, source: "fleet" });

    // The tablet has no expectation row at any layer, so its own default is what stands.
    expect(forOther.find((l) => l.assetTypeId === TABLET)).toMatchObject({ quantity: 1, source: "type" });
  });

  it("gives a reefer the reefer kit and a dry van none of it", () => {
    const reefer = resolveExpected({ kind: "reefer_trailer", unitId: REEFER }, rows, defaults);
    const dryVan = resolveExpected({ kind: "trailer", unitId: DRYVAN }, rows, defaults);
    expect(reefer.find((l) => l.assetTypeId === CABLE)).toMatchObject({ quantity: 1, source: "fleet" });
    // …and the dry van does not carry the line at all, because a type whose default is zero and
    // whose only rule is for another kind is not part of this unit's kit.
    expect(dryVan.find((l) => l.assetTypeId === CABLE)).toBeUndefined();
  });

  it("leaves a type nobody expects out of the kit entirely", () => {
    // `CABLE` defaults to zero. A line reading "0 expected, 0 held" is furniture.
    const forTruck = resolveExpected({ kind: "tractor", unitId: TRUCK }, [], defaults);
    expect(forTruck.map((l) => l.assetTypeId)).toEqual([TABLET, BAR]);
  });
});

describe("the fleet list", () => {
  it("scopes every read to the org, because the service role bypasses RLS", async () => {
    await listUnitKits(rec.client, ORG);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("reports every active tractor and trailer, with the kit each one answers to", async () => {
    rec = recorder({
      expectations: [expectation(), expectation({ asset_type_id: CABLE, unit_kind: "reefer_trailer", quantity: 1 })],
      held: [held(BAR, { trailer: DRYVAN }), held(BAR, { trailer: DRYVAN })],
    });
    const result = await listUnitKits(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");

    const byNumber = Object.fromEntries(result.units.map((u) => [u.unitNumber, u]));
    expect(Object.keys(byNumber).sort()).toEqual(["654", "R-8800", "T-4102"]);
    // The dry van holds the two bars its fleet rule asks for — and is still SHORT, because the
    // tablet's own default of one applies to every unit and it has none.
    expect(byNumber["T-4102"]?.kind).toBe("trailer");
    expect(byNumber["R-8800"]?.kind).toBe("reefer_trailer");
    expect(byNumber["T-4102"]?.lines.find((l) => l.assetTypeId === BAR)).toMatchObject({ expected: 2, held: 2, delta: 0 });
  });

  /**
   * The done-when, end to end through the list rather than through `resolveExpected` alone: the
   * reefer's own kit reaches it and the dry van beside it never sees the line. Written this way
   * because the kind is derived inside `listUnitKits`, and a hand-built kind in a unit test would
   * pass against a list that called every trailer a `trailer`.
   */
  it("gives the reefer the reefer kit, and the dry van beside it none of it", async () => {
    rec = recorder({
      expectations: [
        expectation({ asset_type_id: CABLE, unit_kind: "reefer_trailer", quantity: 1, asset_types: { name: "Reefer cable", default_kit_quantity: 0 } }),
      ],
      held: [],
    });
    const result = await listUnitKits(rec.client, ORG, { kind: "trailer" });
    if ("error" in result) throw new Error("unexpected error");
    const byNumber = Object.fromEntries(result.units.map((u) => [u.unitNumber, u]));
    expect(byNumber["R-8800"]?.lines.find((l) => l.assetTypeId === CABLE)).toMatchObject({
      expected: 1,
      held: 0,
      source: "fleet",
    });
    expect(byNumber["T-4102"]?.lines.find((l) => l.assetTypeId === CABLE)).toBeUndefined();
  });

  it("counts a shortfall as the number of things missing, not the number of lines", async () => {
    rec = recorder({ expectations: [expectation()], held: [] });
    const result = await listUnitKits(rec.client, ORG, { kind: "trailer" });
    if ("error" in result) throw new Error("unexpected error");
    const dryVan = result.units.find((u) => u.unitNumber === "T-4102")!;
    // Two bars and one tablet: three things, two lines. The home page counts things.
    expect(dryVan.state).toBe("short");
    expect(dryVan.shortBy).toBe(3);
  });

  /**
   * ⚠ A type's own `default_kit_quantity` applies to EVERY kind of unit, tractors included — there
   * is no kind on `asset_types`. That is not this file's choice: `move_asset` falls back to the same
   * column without asking what kind of unit it is looking at, so a units read that scoped the type
   * layer by kind would disagree with `IV020` about the same truck.
   */
  it("applies a type's own default to a tractor as readily as to a trailer", async () => {
    rec = recorder({ expectations: [], held: [] });
    const result = await listUnitKits(rec.client, ORG, { kind: "tractor" });
    if ("error" in result) throw new Error("unexpected error");
    const truck = result.units[0]!;
    // One tablet and two bars, from the two types whose default is non-zero.
    expect(truck.shortBy).toBe(3);
    expect(truck.lines.every((l) => l.source === "type")).toBe(true);
  });

  it("filters to the short ones when asked, which is what the home card links to", async () => {
    rec = recorder({
      expectations: [],
      held: [
        held(TABLET, { vehicle: TRUCK }),
        held(BAR, { vehicle: TRUCK }),
        held(BAR, { vehicle: TRUCK }),
      ],
    });
    const all = await listUnitKits(rec.client, ORG);
    const short = await listUnitKits(rec.client, ORG, { shortOnly: true });
    if ("error" in all || "error" in short) throw new Error("unexpected error");
    // The truck holds everything the type defaults ask for; the two trailers hold nothing.
    expect(all.units).toHaveLength(3);
    expect(short.units.map((u) => u.unitNumber).sort()).toEqual(["R-8800", "T-4102"]);
  });

  it("does not look a driver up for a list it does not show one on", async () => {
    await listUnitKits(rec.client, ORG);
    expect(rec.forTable("drivers")).toHaveLength(0);
  });
});

describe("one unit", () => {
  it("answers with the assets it is actually carrying", async () => {
    rec = recorder({ expectations: [expectation()], held: [held(BAR, { trailer: DRYVAN }, "as-1")] });
    const result = await getUnitKit(rec.client, ORG, "trailer", DRYVAN);
    if (!result || "error" in result) throw new Error("unexpected error");
    expect(result.unit.unitNumber).toBe("T-4102");
    expect(result.assets.map((a) => a.id)).toEqual(["as-1"]);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("answers null for a unit that is not this org's, which is what a missing one also is", async () => {
    rec = createSupabaseRecorder({ tables: { vehicles: () => [], trailers: () => [], asset_types: () => [], kit_expectations: () => [], inventory_assets: () => [] } });
    expect(await getUnitKit(rec.client, ORG, "tractor", TRUCK)).toBeNull();
  });
});
