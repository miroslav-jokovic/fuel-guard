import { describe, expect, it, beforeEach, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * The inventory service layer (INVENTORY-PLAN.md step I2).
 *
 * ── WHAT IS WORTH ASSERTING HERE, GIVEN THE MATRIX EXISTS ──────────────────────────────────────
 * `supabase/tests/inventory-stock.test.mjs` owns the arithmetic: the projection, the replay, IV010,
 * the transfer's two legs. None of that is repeated here, because a mock cannot prove any of it.
 *
 * What this layer can get wrong, and the matrix cannot see:
 *
 *   · the org filter. The API reads with the SERVICE ROLE and bypasses RLS, so a missing `.eq
 *     ("org_id")` is a cross-tenant read that every test still passes. `expectOrgScoped` asserts it
 *     on every recorded query rather than on a chosen one;
 *   · `numeric` arrives as a STRING. `last_cost` and `unit_cost` handed through unconverted fail
 *     `partDtoSchema` at the edge for every part that has ever been received — which is to say, in
 *     production and not here, unless it is pinned;
 *   · the movement id must be the CLIENT's. A service that generated its own would break D-INV27's
 *     idempotency silently: every replay would be a new movement and the shelf would drift;
 *   · a named SQLSTATE must reach the shop as a sentence. An unmapped `IV010` is "Something went
 *     wrong" in front of somebody holding the last filter.
 */

const ORG = "org-1";
const USER = "user-1";
const PART = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const MOVEMENT = "33333333-3333-4333-8333-333333333333";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));

const { listParts, getPart, findPartsByUpc } = await import("./parts.js");
const { listStock, listLowStock, listLocations } = await import("./stock.js");
const { listMovements, recordMovement } = await import("./movements.js");

const partRow = (over: Record<string, unknown> = {}) => ({
  id: PART,
  part_number: "LF-9009",
  description: "Oil filter",
  manufacturer: "Luber-finer",
  category: "filters",
  unit_of_measure: "each",
  upc: "012345678905",
  image_path: null,
  // PostgREST renders `numeric` as a string. This fixture is a string ON PURPOSE — a number here
  // would make the conversion below untestable, which is how this class of bug survives a test suite.
  last_cost: "12.50",
  active: true,
  notes: null,
  ...over,
});

const stockRow = (over: Record<string, unknown> = {}) => ({
  part_id: PART,
  location_id: LOCATION,
  quantity_on_hand: 20,
  reorder_point: 5,
  reorder_quantity: 24,
  aisle: null,
  row: null,
  bin: null,
  tag_code: null,
  active: true,
  parts: { part_number: "LF-9009", description: "Oil filter", unit_of_measure: "each", last_cost: "12.50" },
  stock_locations: { name: "Main bay" },
  ...over,
});

const movementRow = (over: Record<string, unknown> = {}) => ({
  id: MOVEMENT,
  part_id: PART,
  location_id: LOCATION,
  reason: "received",
  adjust_reason: null,
  quantity_delta: 24,
  counted_total: null,
  count_session_id: null,
  unit_cost: "12.50",
  supplier: "Fleetpride",
  vehicle_id: null,
  trailer_id: null,
  work_order_ref: null,
  note: null,
  actor_user_id: USER,
  transfer_group_id: null,
  blind: null,
  occurred_at: "2026-09-09T10:00:00.000Z",
  received_at: "2026-09-09T10:00:02.000Z",
  ...over,
});

describe("inventory reads", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({
      tables: {
        parts: [partRow()],
        part_stock: [stockRow()],
        part_movements: [movementRow()],
        stock_locations: [{ id: LOCATION, name: "Main bay", code: "MAIN", address: null, active: true }],
      },
    });
  });

  it("scopes every read to the org, because the service role bypasses RLS", async () => {
    await listParts(rec.client, ORG);
    await getPart(rec.client, ORG, PART);
    await findPartsByUpc(rec.client, ORG, "012345678905");
    await listStock(rec.client, ORG, { locationId: LOCATION });
    await listLocations(rec.client, ORG);
    await listMovements(rec.client, ORG, { partId: PART });
    // `user_profiles` is keyed by auth user id and carries no org, which is `memberLabels`' own
    // design and the same exemption `modules/org/routes/members.test.ts:190` takes. It is reached
    // only for a DEPARTED actor, and only for ids that came off org-scoped rows in the first place —
    // `listMovements` never asks it for anybody it did not already read out of this org's ledger.
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  it("converts a numeric cost from the string PostgREST actually sends", async () => {
    const out = await listParts(rec.client, ORG);
    expect("parts" in out && out.parts[0]!.lastCost).toBe(12.5);
    const line = await listStock(rec.client, ORG);
    expect("lines" in line && line.lines[0]!.lastCost).toBe(12.5);
    const moves = await listMovements(rec.client, ORG);
    expect("movements" in moves && moves.movements[0]!.unitCost).toBe(12.5);
  });

  it("hides retired parts unless they are asked for", async () => {
    await listParts(rec.client, ORG);
    expect(rec.forTable("parts")[0]!.filters()).toContainEqual({ col: "active", val: true });
    rec.reset();
    await listParts(rec.client, ORG, { includeInactive: true });
    expect(rec.forTable("parts")[0]!.filters()).not.toContainEqual({ col: "active", val: true });
  });

  it("reads a page rather than trusting a limit PostgREST would cap anyway", async () => {
    await listParts(rec.client, ORG, { limit: 10_000 });
    const range = rec.forTable("parts")[0]!.ops.find((o) => o.method === "range");
    expect(range?.args).toEqual([0, 199]);
  });

  it("asks the contract whether a line is low, rather than restating the threshold", async () => {
    rec = createSupabaseRecorder({
      tables: {
        // Four lines that discriminate: one plainly low, one plainly not, and the two edges the rule
        // actually turns on — a NULL reorder point, which means "nobody has said what enough means"
        // and is not a shortage, and a reorder point of ZERO, which is a real instruction to warn at
        // empty. A copied `quantity <= reorder_point` predicate gets the zero case wrong.
        part_stock: [
          stockRow({ part_id: "low", quantity_on_hand: 2, reorder_point: 5 }),
          stockRow({ part_id: "fine", quantity_on_hand: 40, reorder_point: 5 }),
          stockRow({ part_id: "unset", quantity_on_hand: 0, reorder_point: null }),
          stockRow({ part_id: "zero-point", quantity_on_hand: 0, reorder_point: 0 }),
        ],
      },
    });
    const out = await listLowStock(rec.client, ORG);
    expect("lines" in out && out.lines.map((l) => l.partId)).toEqual(["low", "zero-point"]);
  });

  /**
   * ⚠ The defect this pins is the one the 2026-09-09 review found: low stock used to be a flag on
   * `listStock`, which fetches ONE page and filtered it, so a shop with more stock lines than a page
   * got the low ones from the first 200 rows and a total counting only those. A low-stock list that
   * under-reports says "nothing to order" and is believed.
   *
   * The fixture is deliberately shaped so a single-page reader CANNOT pass: the only low line is on
   * the SECOND page, behind a full first page of lines that are all fine.
   */
  it("pages to the end, so a low line on the second page is still found", async () => {
    const full = Array.from({ length: 200 }, (_, i) =>
      stockRow({ part_id: `fine-${i}`, quantity_on_hand: 40, reorder_point: 5 }),
    );
    rec = createSupabaseRecorder({
      tables: {
        part_stock: {
          pages: [full, [stockRow({ part_id: "buried", quantity_on_hand: 1, reorder_point: 5 })]],
        },
      },
    });
    const out = await listLowStock(rec.client, ORG);
    expect("lines" in out && out.lines.map((l) => l.partId)).toEqual(["buried"]);
    expect("total" in out && out.total).toBe(1);
    // Two reads, not one — and the second was asked for by offset, not by luck.
    expect(rec.forTable("part_stock")).toHaveLength(2);
  });

  it("asks the database only for lines that HAVE a reorder point, and never for a threshold", async () => {
    rec = createSupabaseRecorder({ tables: { part_stock: [] } });
    await listLowStock(rec.client, ORG);
    const ops = rec.forTable("part_stock")[0]!.ops.map((o) => o.method);
    // `.not("reorder_point","is",null)` is the rule's own NULL branch, not its threshold. Nothing
    // here compares a quantity to anything — `isLowStock` does that, in one place.
    expect(ops).toContain("not");
  });

});

describe("recording a movement", () => {
  beforeEach(() => {
    rec = createSupabaseRecorder({ rpc: { record_part_movement: movementRow() } });
  });

  it("sends the client's id to the RPC untouched — D-INV27's whole mechanism", async () => {
    await recordMovement(rec.client, ORG, USER, {
      id: MOVEMENT,
      partId: PART,
      locationId: LOCATION,
      reason: "received",
      quantity: 24,
      occurredAt: "2026-09-09T10:00:00.000Z",
    });
    const call = rec.rpcs()[0]!;
    expect(call.fn).toBe("record_part_movement");
    expect(call.args).toMatchObject({ p_org: ORG, p_actor: USER });
    expect((call.args as { p_row: { id: string } }).p_row.id).toBe(MOVEMENT);
  });

  it("does no arithmetic of its own — the payload reaches SQL as the contract built it", async () => {
    await recordMovement(rec.client, ORG, USER, {
      id: MOVEMENT,
      partId: PART,
      locationId: LOCATION,
      reason: "issued",
      quantity: 3,
      vehicleId: "44444444-4444-4444-8444-444444444444",
      occurredAt: "2026-09-09T10:00:00.000Z",
    });
    const row = (rec.rpcs()[0]!.args as { p_row: Record<string, unknown> }).p_row;
    // Positive. The sign of an issue is decided in SQL (0331, step 7) and a service that negated it
    // here would double-negate it there.
    expect(row.quantity).toBe(3);
    expect(row.quantityDelta).toBeUndefined();
  });

  it.each([
    ["IV010", "There is not enough of this part on the shelf for that."],
    ["IV013", "That part is not available."],
    ["IV014", "This device's clock looks wrong — check the date and try again."],
    ["IV016", "That movement is already being recorded — try again in a moment."],
  ])("turns %s into a sentence the shop can act on", async (code, message) => {
    // The recorder passes a scripted `{ error }` through as a FAILED call, the same shape a real
    // PostgREST rpc failure has. Throwing here instead would test the harness, not the mapping.
    rec = createSupabaseRecorder({ rpc: () => ({ error: { code, message: "db" } }) });
    const out = await recordMovement(rec.client, ORG, USER, {
      id: MOVEMENT,
      partId: PART,
      locationId: LOCATION,
      reason: "received",
      quantity: 1,
      occurredAt: "2026-09-09T10:00:00.000Z",
    });
    expect(out).toEqual({ error: message, code });
  });
});
