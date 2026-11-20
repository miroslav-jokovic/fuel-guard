import { describe, expect, it } from "vitest";
import { ORDER_CHARGE_KEYS, carriesOrderCharges, orderChargeProblem, tmsDispatchMovementsPayloadSchema } from "./tmsDispatchMirror.js";

/**
 * The order's charges at the mirror's door (LOAD-RATES-PLAN D-RATE9): optional while the Board VM runs a
 * connector that does not read them, but all seven or none, per movement and per batch.
 */
const movement = (id: string, extra: Record<string, unknown> = {}) => ({
  movement_id: id, order_id: "0132143", blnum: null, movement_status: "P", loaded: "L", dispatcher_user_id: "romann",
  driver_codes: ["DKELLY"], tractor_id: "702", trailer_id: null, trailer_type: "V", commodity: null, customer_id: null,
  customer_name: null, weight: null, weight_um: null, pieces: null, pallets_how_many: null, consignee_refno: null,
  move_distance: 377, stops: [], ...extra,
});
const charges = {
  total_charge: 3620, freight_charge: 3500, otherchargetotal: 120, total_charge_c: "USD",
  bill_distance: 836, bill_distance_um: "MI", order_loaded_movements: 2,
};
const parse = (movements: unknown[]) => tmsDispatchMovementsPayloadSchema.safeParse({ company_id: "TMS", movements });

describe("order charges at the dispatch mirror's door (D-RATE9)", () => {
  it("names exactly the seven raw columns 0638 added", () => {
    expect([...ORDER_CHARGE_KEYS].sort()).toEqual([
      "bill_distance", "bill_distance_um", "freight_charge", "order_loaded_movements", "otherchargetotal", "total_charge", "total_charge_c",
    ]);
  });

  it("accepts the Board VM's current connector, which sends none of them", () => {
    const r = parse([movement("1"), movement("2")]);
    expect(r.success).toBe(true);
    expect(carriesOrderCharges(r.data!.movements[0]!)).toBe(false);
  });

  it("accepts all seven on every movement, and keeps them", () => {
    const r = parse([movement("1", charges), movement("2", charges)]);
    expect(r.success).toBe(true);
    expect(r.data!.movements[0]).toMatchObject(charges);
    expect(carriesOrderCharges(r.data!.movements[1]!)).toBe(true);
  });

  it("null is McLeod's blank and counts as sent — all seven null is a movement that carries charges", () => {
    const blanks = Object.fromEntries(ORDER_CHARGE_KEYS.map((k) => [k, null]));
    const r = parse([movement("1", blanks)]);
    expect(r.success).toBe(true);
    expect(carriesOrderCharges(r.data!.movements[0]!)).toBe(true);
  });

  it("accepts a negative other charge and a $0 total, as McLeod records them", () => {
    expect(parse([movement("1", { ...charges, total_charge: 0, otherchargetotal: -1000 })]).success).toBe(true);
  });

  it("refuses a movement that sends some of the seven, naming it and what is missing", () => {
    const { bill_distance_um: _gone, ...six } = charges;
    const r = parse([movement("1", six)]);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("movements.0: order charges must be sent together — missing bill_distance_um");
  });

  it("refuses a batch where some movements carry charges and others do not", () => {
    const r = parse([movement("1", charges), movement("2")]);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("order charges must be sent for every movement in a batch or for none — 1 of 2 carry them");
  });

  it("refuses a charge that is not a number, and a leg count that is not a whole non-negative number", () => {
    expect(parse([movement("1", { ...charges, total_charge: "3620" })]).success).toBe(false);
    expect(parse([movement("1", { ...charges, order_loaded_movements: 1.5 })]).success).toBe(false);
    expect(parse([movement("1", { ...charges, order_loaded_movements: -1 })]).success).toBe(false);
  });

  it("an empty batch has nothing to refuse", () => {
    expect(orderChargeProblem([])).toBeNull();
  });
});
