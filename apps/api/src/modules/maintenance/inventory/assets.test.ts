import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The asset services (INVENTORY-PLAN.md step I7).
 *
 * ── WHAT THIS LAYER CAN GET WRONG, GIVEN 0333's MATRIX EXISTS ──────────────────────────────────
 * `supabase/tests/inventory-assets.test.mjs` owns the schema's promises — one holder at a time, the
 * holder belongs to this org, the holder columns equal the last movement, `IV020` fires. None of
 * that is repeated here, because a mock cannot prove any of it.
 *
 * What is only true in TypeScript, and is therefore pinned here:
 *
 *   · **the org filter.** The API reads with the service role and bypasses RLS, so a missing
 *     `.eq("org_id")` is a cross-tenant read that every other assertion still passes;
 *   · **`displayNo` is DERIVED from `display_seq`.** The database allocates the number and
 *     `nextDisplayNo` owns the format; a service that stopped calling it would emit a bare integer
 *     into a field every label, radio call and work order in the product spells `A-0412`;
 *   · **the holder is assembled from whichever of three columns is set**, and three nulls is
 *     `unassigned` rather than a missing value;
 *   · **the driver is inferred and only for a truck** (D-INV3) — a trailer's driver is whoever is
 *     pulling it today, which is a different question with a different answer;
 *   · **`since` excludes the reasons that move nothing** (D-INV24): a fridge reported missing in
 *     March has been unit 654's since January;
 *   · **the `IV0xx` codes reach the caller as themselves.** A code that fell into the generic
 *     `db_error` branch would answer a technician "Something went wrong" about a truck that is
 *     simply already carrying one, and `httpStatus.ts` would never map it.
 *
 * ⚠ Fixtures are FUNCTIONS, not flat arrays. `supabaseRecorder` records `.eq()` and does not apply
 * it, so a flat array answers "the assets in truck 654" with the trailer's too — and the assertion
 * that a holder filter works would pass against a service that never sent one.
 */

const ORG = "org-1";
const USER = "user-1";
const CRIB = "11111111-1111-4111-8111-111111111111";
const T654 = "22222222-2222-4222-8222-222222222222";
const DRYVAN = "33333333-3333-4333-8333-333333333333";
const DRIVER = "44444444-4444-4444-8444-444444444444";
const TABLET = "55555555-5555-4555-8555-555555555555";
const A_CRIB = "aaaaaaaa-1111-4111-8111-111111111111";
const A_TRUCK = "aaaaaaaa-2222-4222-8222-222222222222";
const A_TRAILER = "aaaaaaaa-3333-4333-8333-333333333333";
const A_LOOSE = "aaaaaaaa-4444-4444-8444-444444444444";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { listAssets, getAsset, displaySeqOf } = await import("./assets.js");
const { createAsset, updateAsset } = await import("./assetsWrite.js");
const { listAssetMovements, moveAsset } = await import("./assetMovements.js");
const { listKitExpectations, setKitExpectation } = await import("./kitExpectations.js");

const assetRow = (over: Record<string, unknown> = {}) => ({
  id: A_CRIB,
  tag_code: null,
  display_seq: 412,
  asset_type_id: TABLET,
  name: "Crib tablet",
  serial_number: "SN-1",
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  location_id: CRIB,
  vehicle_id: null,
  trailer_id: null,
  purchased_at: null,
  purchase_cost: "429.00",
  warranty_expires_at: null,
  image_path: null,
  notes: null,
  asset_types: { name: "Tablet" },
  stock_locations: { name: "Tool crib" },
  vehicles: null,
  trailers: null,
  ...over,
});

const inTruck = () =>
  assetRow({
    id: A_TRUCK,
    display_seq: 1,
    location_id: null,
    vehicle_id: T654,
    stock_locations: null,
    vehicles: { unit_number: "654", assigned_driver_id: DRIVER },
  });

const inTrailer = () =>
  assetRow({
    id: A_TRAILER,
    display_seq: 10_000,
    location_id: null,
    trailer_id: DRYVAN,
    stock_locations: null,
    trailers: { unit_number: "T-4102" },
  });

/** Nothing decided yet — three nulls, which is a state and not a missing value. */
const unplaced = () =>
  assetRow({ id: A_LOOSE, display_seq: 2, location_id: null, stock_locations: null });

const assets = () => [assetRow(), inTruck(), inTrailer(), unplaced()];

/** Answers on the filters the service actually sent, which a flat array cannot do. */
const byFilters = (q: { filters: () => Array<{ col: string; val: unknown }> }) => {
  const f = q.filters();
  const eq = new Map(f.filter((x) => x.val !== null).map((x) => [x.col, x.val]));
  const isNull = new Set(f.filter((x) => x.val === null).map((x) => x.col));
  return assets().filter(
    (r) =>
      (!eq.has("id") || r.id === eq.get("id")) &&
      (!eq.has("vehicle_id") || r.vehicle_id === eq.get("vehicle_id")) &&
      (!eq.has("trailer_id") || r.trailer_id === eq.get("trailer_id")) &&
      (!eq.has("location_id") || r.location_id === eq.get("location_id")) &&
      [...isNull].every((col) => (r as Record<string, unknown>)[col] === null),
  );
};

const DRIVERS = [{ id: DRIVER, full_name: "Dana Reyes" }];
const SCOPED = { exempt: ["user_profiles"] };

describe("asset reads", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        inventory_assets: byFilters,
        drivers: DRIVERS,
        asset_movements: [{ occurred_at: "2026-01-04T08:00:00.000Z" }],
      },
    });
  });

  it("scopes every read to the org, because the service role bypasses RLS", async () => {
    await listAssets(rec.client, ORG);
    await getAsset(rec.client, ORG, A_TRUCK);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  /**
   * The identifier a technician says out loud. `nextDisplayNo` owns the format — including the
   * block roll at 9999 that keeps the width fixed, which is why `A_TRAILER` sits at 10,000.
   */
  it("derives the display number from the sequence rather than emitting the integer", async () => {
    const result = await listAssets(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    const numbers = Object.fromEntries(result.assets.map((a) => [a.id, a.displayNo]));
    expect(numbers[A_CRIB]).toBe("A-0412");
    expect(numbers[A_TRUCK]).toBe("A-0001");
    expect(numbers[A_TRAILER]).toBe("B-0001");
  });

  it("assembles the holder from whichever column is set", async () => {
    const result = await listAssets(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    const holders = Object.fromEntries(result.assets.map((a) => [a.id, a.holder]));
    expect(holders[A_CRIB]).toMatchObject({ kind: "location", id: CRIB, label: "Tool crib" });
    expect(holders[A_TRUCK]).toMatchObject({ kind: "vehicle", id: T654, label: "654" });
    // The trailer's unit number, and NOT the bay's name — the select lists locations first.
    expect(holders[A_TRAILER]).toMatchObject({ kind: "trailer", id: DRYVAN, label: "T-4102" });
  });

  it("calls three nulls unassigned rather than a missing holder", async () => {
    const result = await listAssets(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.assets.find((a) => a.id === A_LOOSE)?.holder).toMatchObject({
      kind: "unassigned",
      id: null,
      label: null,
    });
  });

  it("sends the unassigned filter as three IS NULLs, which no equality can ask for", async () => {
    const result = await listAssets(rec.client, ORG, { unassigned: true });
    if ("error" in result) throw new Error("unexpected error");
    expect(result.assets.map((a) => a.id)).toEqual([A_LOOSE]);
  });

  it("sends the holder filter rather than filtering after the fact", async () => {
    const result = await listAssets(rec.client, ORG, { vehicleId: T654 });
    if ("error" in result) throw new Error("unexpected error");
    expect(result.assets.map((a) => a.id)).toEqual([A_TRUCK]);
  });

  /**
   * D-INV3. The person is read off the truck at the moment somebody looks and is stored nowhere —
   * and a trailer has no driver here, because whoever is pulling it today is a different question.
   */
  it("infers the driver from the truck, and only for a truck", async () => {
    const result = await listAssets(rec.client, ORG);
    if ("error" in result) throw new Error("unexpected error");
    const byId = Object.fromEntries(result.assets.map((a) => [a.id, a.holder.inferredDriverName]));
    expect(byId[A_TRUCK]).toBe("Dana Reyes");
    expect(byId[A_TRAILER]).toBeNull();
    expect(byId[A_CRIB]).toBeNull();
  });

  it("resolves the drivers of a page in one call, never one per row", async () => {
    await listAssets(rec.client, ORG);
    expect(rec.forTable("drivers")).toHaveLength(1);
  });

  it("does not ask the directory anything when no asset is in a truck", async () => {
    rec = createSupabaseRecorder({ tables: { inventory_assets: () => [assetRow()], drivers: DRIVERS } });
    await listAssets(rec.client, ORG);
    expect(rec.forTable("drivers")).toHaveLength(0);
  });

  /**
   * "Since when" is the detail page's question and is deliberately absent from the list: one bounded
   * query for one asset is honest, and one for a page is the unbounded read that cost nine filter
   * menus 30 % of their values to PostgREST's 1,000-row cap.
   */
  it("answers since-when on the detail and leaves it null in the list", async () => {
    const detail = await getAsset(rec.client, ORG, A_TRUCK);
    if (!detail || "error" in detail) throw new Error("unexpected error");
    expect(detail.holder.since).toBe("2026-01-04T08:00:00.000Z");

    const list = await listAssets(rec.client, ORG);
    if ("error" in list) throw new Error("unexpected error");
    expect(list.assets.every((a) => a.holder.since === null)).toBe(true);
  });

  it("...and reads it off a movement that actually moved the thing (D-INV24)", async () => {
    await getAsset(rec.client, ORG, A_TRUCK);
    const history = rec.forTable("asset_movements")[0];
    const notOp = history?.ops.find((o) => o.method === "not");
    expect(notOp?.args).toEqual(["reason", "in", "(reported_missing,reported_damaged)"]);
  });

  it("answers null for an asset that is not this org's, rather than someone else's row", async () => {
    rec = createSupabaseRecorder({ tables: { inventory_assets: () => [] } });
    expect(await getAsset(rec.client, ORG, A_CRIB)).toBeNull();
  });
});

describe("writing an asset", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({ tables: { inventory_assets: [assetRow()], drivers: DRIVERS } });
  });

  const input = { assetTypeId: TABLET, name: "Crib tablet", status: "in_service", condition: "good" } as const;

  it("takes the opening position but invents neither the number nor the tag", async () => {
    await createAsset(rec.client, ORG, input, { locationId: CRIB });
    const payload = rec.writes().find((w) => w.table === "inventory_assets")?.write?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ org_id: ORG, asset_type_id: TABLET, location_id: CRIB });
    // ⚠ Both are the database's. `display_seq` is allocated by 0333's trigger under a lock — an
    // "allocate then insert" pair from here would race, because the lock would be gone between the
    // two round trips — and a tag is issued at I10 with a uniqueness check this service cannot do.
    expect(Object.keys(payload)).not.toContain("display_seq");
    expect(Object.keys(payload)).not.toContain("tag_code");
  });

  it("never writes a holder column on an edit, because move_asset is the only door", async () => {
    await updateAsset(rec.client, ORG, A_CRIB, { name: "Renamed", condition: "worn" });
    const payload = rec.writes().find((w) => w.table === "inventory_assets")?.write?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({ name: "Renamed", condition: "worn" });
    for (const col of ["location_id", "vehicle_id", "trailer_id"]) {
      expect(Object.keys(payload)).not.toContain(col);
    }
  });

  it("turns the org guard's refusal into a sentence about the place, not a 500", async () => {
    rec = createSupabaseRecorder({
      tables: { inventory_assets: () => ({ error: { code: "IV012", message: "not ours" } }) },
    });
    expect(await createAsset(rec.client, ORG, input, { locationId: CRIB })).toMatchObject({ code: "IV012" });
  });

  it("reports a taken tag the same way whether the trigger or the index caught it", async () => {
    for (const code of ["IV022", "23505"]) {
      rec = createSupabaseRecorder({
        tables: { inventory_assets: () => ({ error: { code, message: "tag" } }) },
      });
      expect(await updateAsset(rec.client, ORG, A_CRIB, { name: "x" })).toMatchObject({ code: "IV022" });
    }
  });
});

describe("moving an asset", () => {
  const movementRow = {
    id: "mm-1",
    asset_id: A_TRUCK,
    reason: "assigned",
    from_location_id: CRIB,
    from_vehicle_id: null,
    from_trailer_id: null,
    to_location_id: null,
    to_vehicle_id: T654,
    to_trailer_id: null,
    condition: null,
    note: null,
    actor_user_id: USER,
    actor_driver_id: null,
    count_session_id: null,
    occurred_at: "2026-09-09T10:00:00.000Z",
    received_at: "2026-09-09T10:00:01.000Z",
  };
  const input = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    assetId: A_TRUCK,
    reason: "assigned" as const,
    toVehicleId: T654,
    occurredAt: "2026-09-09T10:00:00.000Z",
  };

  it("passes the client's id to the RPC and does not invent one", async () => {
    rec = createSupabaseRecorder({ rpc: { move_asset: movementRow } });
    await moveAsset(rec.client, ORG, USER, input);
    const call = rec.rpcs()[0];
    expect(call?.fn).toBe("move_asset");
    // D-INV27: the id is the idempotency key for the offline queue, so it must be the caller's.
    // Generating one here per attempt breaks the queue's server half without breaking any test.
    expect((call?.args as { p_row: { id: string } }).p_row.id).toBe(input.id);
    expect((call?.args as { p_org: string }).p_org).toBe(ORG);
  });

  it("renders both ends of the move from the row the RPC returned", async () => {
    rec = createSupabaseRecorder({ rpc: { move_asset: movementRow } });
    const result = await moveAsset(rec.client, ORG, USER, input);
    if ("error" in result) throw new Error("unexpected error");
    expect(result.fromHolder).toMatchObject({ kind: "location", id: CRIB });
    expect(result.toHolder).toMatchObject({ kind: "vehicle", id: T654 });
  });

  /**
   * The one that matters. Each of these is a sentence a technician can act on, and each would
   * otherwise reach them as "Something went wrong" — `httpStatus.ts` maps IV020 to a 409 and IV023
   * and IV024 to a 422, and none of that is reached if the code is swallowed here.
   */
  it("hands every named refusal onward as itself", async () => {
    for (const code of ["IV012", "IV014", "IV016", "IV020", "IV023", "IV024"]) {
      rec = createSupabaseRecorder({ rpc: { move_asset: { error: { code, message: code } } } });
      const result = await moveAsset(rec.client, ORG, USER, input);
      expect(result).toMatchObject({ code });
      expect((result as { error: string }).error).not.toMatch(/went wrong/i);
    }
  });

  it("scopes a history read to the org and asks a unit for what landed there", async () => {
    rec = createSupabaseRecorder({ tables: { asset_movements: [movementRow] } });
    await listAssetMovements(rec.client, ORG, { vehicleId: T654 });
    expectOrgScoped(rec, ORG, SCOPED);
    // The `to_` end, not the `from_` end: a row's `from_` belongs to the unit it LEFT, and asking
    // for both would report every departure twice on the unit that lost it.
    const cols = rec.forTable("asset_movements")[0]?.filters().map((f) => f.col);
    expect(cols).toContain("to_vehicle_id");
    expect(cols).not.toContain("from_vehicle_id");
  });
});

describe("kit expectations", () => {
  const fleetRow = {
    id: "k-1",
    asset_type_id: TABLET,
    unit_kind: "tractor",
    vehicle_id: null,
    trailer_id: null,
    quantity: 1,
    asset_types: { name: "Tablet" },
  };

  it("scopes the read to the org and asks for the fleet layer with IS NULL", async () => {
    rec = createSupabaseRecorder({ tables: { kit_expectations: [fleetRow] } });
    await listKitExpectations(rec.client, ORG, { fleetOnly: true });
    expectOrgScoped(rec, ORG, SCOPED);
    const nulls = rec
      .forTable("kit_expectations")[0]
      ?.filters()
      .filter((f) => f.val === null)
      .map((f) => f.col);
    expect(nulls).toEqual(["vehicle_id", "trailer_id"]);
  });

  /**
   * ⚠ Not an upsert, and the reason is the three PARTIAL unique indexes 0333 carries: PostgREST's
   * `onConflict` names columns rather than a partial index, so which rule it arbitrated on would
   * depend on which columns happened to be null. `lint:upserts` forbids the partial payload; this
   * is the UPDATE-then-INSERT the house pattern (migrations 0174/0175) prescribes instead.
   */
  it("updates the rule that already exists rather than inserting a second", async () => {
    rec = createSupabaseRecorder({ tables: { kit_expectations: [fleetRow] } });
    await setKitExpectation(rec.client, ORG, { assetTypeId: TABLET, unitKind: "tractor", quantity: 2 });
    const methods = rec.writes().map((w) => w.write?.method);
    expect(methods).toEqual(["update"]);
  });

  it("...and inserts when no rule is there yet", async () => {
    let read = 0;
    rec = createSupabaseRecorder({
      tables: {
        // The lookup finds nothing; the insert returns the row it wrote. A flat fixture would
        // answer BOTH with the same rows and the update branch would be taken every time.
        kit_expectations: (q) => (q.write ? [fleetRow] : (read++, [])),
      },
    });
    await setKitExpectation(rec.client, ORG, { assetTypeId: TABLET, unitKind: "tractor", quantity: 2 });
    expect(rec.writes().map((w) => w.write?.method)).toEqual(["insert"]);
    expect(read).toBe(1);
  });

  it("turns the unit guard's refusal into a sentence, not a 500", async () => {
    rec = createSupabaseRecorder({
      tables: { kit_expectations: (q) => (q.write ? { error: { code: "IV012", message: "x" } } : []) },
    });
    const result = await setKitExpectation(rec.client, ORG, {
      assetTypeId: TABLET,
      unitKind: "trailer",
      trailerId: DRYVAN,
      quantity: 1,
    });
    expect(result).toMatchObject({ code: "IV012" });
  });
});

/**
 * Search (2026-09-10). The list page grew a search box because a manager typing "A-0412" or a
 * serial into the Assets list had no way to find it short of paging — and a client-side filter
 * over one server page would have said "no such asset" about a tablet on page two.
 */
describe("asset search", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: { inventory_assets: byFilters, drivers: DRIVERS, asset_movements: [] },
    });
  });

  it("reads a display number in every spelling the shop uses, and nothing else as one", () => {
    expect(displaySeqOf("A-0412")).toBe(412);
    expect(displaySeqOf("a0412")).toBe(412);
    expect(displaySeqOf("0412")).toBe(412);
    expect(displaySeqOf("412")).toBe(412);
    expect(displaySeqOf("SN-1")).toBeNull();
    expect(displaySeqOf("tablet")).toBeNull();
    expect(displaySeqOf("")).toBeNull();
  });

  it("sends one OR over the text columns, and adds the number only when the term is one", async () => {
    await listAssets(rec.client, ORG, { search: "A-0412" });
    const or = rec.forTable("inventory_assets")[0]!.ops.find((o) => o.method === "or");
    expect(or).toBeDefined();
    const clause = String(or!.args[0]);
    expect(clause).toContain("name.ilike.");
    expect(clause).toContain("serial_number.ilike.");
    expect(clause).toContain("tag_code.ilike.");
    expect(clause).toContain("display_seq.eq.412");
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("leaves the number clause out for a term that is not a number", async () => {
    await listAssets(rec.client, ORG, { search: "SN-1" });
    const or = rec.forTable("inventory_assets")[0]!.ops.find((o) => o.method === "or");
    expect(String(or!.args[0])).not.toContain("display_seq");
  });

  it("sends no OR at all for a blank search", async () => {
    await listAssets(rec.client, ORG, { search: "   " });
    expect(rec.forTable("inventory_assets")[0]!.ops.some((o) => o.method === "or")).toBe(false);
  });
});
