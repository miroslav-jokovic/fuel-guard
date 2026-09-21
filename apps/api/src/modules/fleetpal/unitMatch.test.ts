import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { censusOf, matchFleetpalUnit, normaliseUnitNumber, normaliseVin, type Roster } from "./unitMatch.js";
import { resolveStagedUnits } from "./resolveUnits.js";

/**
 * Identity resolution (FLEETPAL-INTEGRATION-PLAN.md F5, §2.6, D-FP7).
 *
 * The three cases the plan names — a VIN differing only in case, a number colliding between a
 * tractor and a trailer, a unit matching nothing — plus the two the live account added on
 * 2026-09-21: eight FleetPal VINs that appear twice on the VENDOR's side, and a roster read that
 * must include retired equipment or 36 units lose their history.
 */

const VEHICLE = "aaaaaaaa-0000-0000-0000-000000000001";
const VEHICLE_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const TRAILER = "bbbbbbbb-0000-0000-0000-000000000001";
const ORG = "11111111-1111-1111-1111-111111111111";

const roster = (over: Partial<Roster> = {}): Roster => ({
  vehicles: [{ id: VEHICLE, unitNumber: "805", vin: "3HSDZAPR4VN069698" }],
  trailers: [{ id: TRAILER, unitNumber: "4102", vin: "1DW1A5327KBA27311" }],
  ...over,
});

describe("normalising an identifier", () => {
  it("upper-cases and strips whitespace from a VIN", () => {
    expect(normaliseVin(" 3hsdzapr4vn069698 ")).toBe("3HSDZAPR4VN069698");
  });

  it("⚠ does not strip leading zeros from a unit number", () => {
    // "805" and "0805" may well be one truck, and a person can say so with the manual link. A
    // normaliser that decided it would also merge "R532309" with "532309", which are a trailer and
    // a tractor on this fleet.
    expect(normaliseUnitNumber("0805")).not.toBe(normaliseUnitNumber("805"));
  });
});

describe("matching a unit", () => {
  it("matches on VIN when the case differs on both sides", () => {
    const match = matchFleetpalUnit({ vin: "3hsdzapr4vn069698", number: "999" }, roster());
    expect(match).toEqual({ method: "vin", vehicleId: VEHICLE, trailerId: null, reason: "vin" });
  });

  it("⚠ prefers the VIN over a unit number that points somewhere else", () => {
    // The number says trailer 4102, the VIN says vehicle 805. A VIN is manufacturer-issued with a
    // check digit; a unit number is whatever the shop typed.
    const match = matchFleetpalUnit({ vin: "3HSDZAPR4VN069698", number: "4102" }, roster());
    expect(match.vehicleId).toBe(VEHICLE);
    expect(match.method).toBe("vin");
  });

  it("falls back to the unit number when the unit carries no VIN", () => {
    const match = matchFleetpalUnit({ vin: "", number: "4102" }, roster());
    expect(match).toEqual({ method: "number", vehicleId: null, trailerId: TRAILER, reason: "number" });
  });

  it("falls back to the unit number when the VIN matches nothing of ours", () => {
    const match = matchFleetpalUnit({ vin: "1XXXXXXXXXXXXXXXX", number: "805" }, roster());
    expect(match.method).toBe("number");
    expect(match.vehicleId).toBe(VEHICLE);
  });

  it("leaves a unit that matches nothing unmatched, with a reason", () => {
    const match = matchFleetpalUnit({ vin: "1XXXXXXXXXXXXXXXX", number: "9999" }, roster());
    expect(match).toEqual({
      method: "unmatched",
      vehicleId: null,
      trailerId: null,
      reason: "no-candidate",
    });
  });

  it("says so when the unit carries no identifiers at all", () => {
    expect(matchFleetpalUnit({ vin: "", number: "" }, roster()).reason).toBe("no-identifiers");
  });
});

describe("⚠ a number that collides between a tractor and a trailer", () => {
  const colliding = roster({ trailers: [{ id: TRAILER, unitNumber: "805", vin: null }] });

  it("refuses to choose when nothing breaks the tie", () => {
    const match = matchFleetpalUnit({ vin: "", number: "805" }, colliding);
    expect(match).toEqual({
      method: "unmatched",
      vehicleId: null,
      trailerId: null,
      reason: "ambiguous-number",
    });
  });

  it("lets the vendor's equipment category break it — as a hint, never as the decision", () => {
    expect(matchFleetpalUnit({ vin: "", number: "805" }, colliding, "trailer").trailerId).toBe(TRAILER);
    expect(matchFleetpalUnit({ vin: "", number: "805" }, colliding, "tractor").vehicleId).toBe(VEHICLE);
  });

  it("⚠ ignores the hint when the VIN has already decided", () => {
    // A unit that matches trailer 4102 by VIN is a trailer whatever its category says, and the
    // reverse: a category saying "trailer" cannot move a VIN match off a vehicle.
    const match = matchFleetpalUnit({ vin: "3HSDZAPR4VN069698", number: "805" }, colliding, "trailer");
    expect(match.vehicleId).toBe(VEHICLE);
  });
});

describe("⚠ ambiguity on OUR side is never resolved by sort order", () => {
  it("refuses a VIN that picks out two of our rows", () => {
    const duplicated = roster({
      vehicles: [
        { id: VEHICLE, unitNumber: "805", vin: "3HSDZAPR4VN069698" },
        { id: VEHICLE_2, unitNumber: "805-OLD", vin: "3hsdzapr4vn069698" },
      ],
    });
    const match = matchFleetpalUnit({ vin: "3HSDZAPR4VN069698", number: "805" }, duplicated);
    expect(match.reason).toBe("ambiguous-vin");
    expect(match.vehicleId).toBeNull();
  });

  it("⚠ but TWO FLEETPAL UNITS resolving to one vehicle is expected, not ambiguity", () => {
    // Eight VINs appear twice in FleetPal's own unit list (F4) — an old record and its replacement,
    // both live. Each resolves to the same vehicle, which is why `fleetpal_units` is unique on
    // `(org_id, fleetpal_id)` and NOT on `vehicle_id`, and why per-unit cost must sum across rows.
    const one = matchFleetpalUnit({ vin: "3HSDZAPR4VN069698", number: "805" }, roster());
    const two = matchFleetpalUnit({ vin: "3HSDZAPR4VN069698", number: "805 - old" }, roster());
    expect(one.vehicleId).toBe(VEHICLE);
    expect(two.vehicleId).toBe(VEHICLE);
  });
});

describe("the census a cost figure has to print beside itself (D-FP14)", () => {
  it("counts every method", () => {
    expect(
      censusOf([
        { matchMethod: "vin" },
        { matchMethod: "vin" },
        { matchMethod: "number" },
        { matchMethod: "manual" },
        { matchMethod: "unmatched" },
      ]),
    ).toEqual({ total: 5, vin: 2, number: 1, manual: 1, unmatched: 1 });
  });
});

const unitRow = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  fleetpal_id: "Vn7kPq2R",
  number: "805",
  vin: "3HSDZAPR4VN069698",
  name: null,
  archived_at: null,
  vehicle_id: null,
  trailer_id: null,
  match_method: "unmatched",
  matched_at: null,
  ...over,
});

const vehicleRow = { id: VEHICLE, unit_number: "805", vin: "3HSDZAPR4VN069698", plate: null };

describe("resolving everything staged", () => {
  it("writes the match it found, and is org-scoped on every read", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [vehicleRow],
        trailers: [],
        fleetpal_units: (q) => (q.write ? { data: [], error: null } : { data: [unitRow()], error: null }),
      },
    });
    const outcome = await resolveStagedUnits(rec.client, ORG);
    expect("error" in outcome).toBe(false);
    if ("error" in outcome) return;
    expect(outcome.matchedByVin).toBe(1);
    expect(outcome.updated).toBe(1);
    // The API reads with the service role, which bypasses RLS — every query carries its own filter.
    expectOrgScoped(rec, ORG);
  });

  it("⚠ never overwrites a manual link", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [vehicleRow],
        trailers: [],
        fleetpal_units: (q) =>
          q.write
            ? { data: [], error: null }
            : { data: [unitRow({ match_method: "manual", trailer_id: TRAILER, vin: null, number: "805" })], error: null },
      },
    });
    const outcome = await resolveStagedUnits(rec.client, ORG);
    if ("error" in outcome) throw new Error(outcome.error);
    expect(outcome.manualPreserved).toBe(1);
    expect(outcome.updated).toBe(0);
    expect(rec.queries.filter((q) => q.table === "fleetpal_units" && q.write).length).toBe(0);
  });

  it("⚠ writes nothing when the resolution has not changed", async () => {
    // A resolver that re-wrote an unchanged match would touch every row on every run: an audit
    // trail of nothing happening, and a lock taken for it.
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [vehicleRow],
        trailers: [],
        fleetpal_units: (q) =>
          q.write
            ? { data: [], error: null }
            : { data: [unitRow({ match_method: "vin", vehicle_id: VEHICLE })], error: null },
      },
    });
    const outcome = await resolveStagedUnits(rec.client, ORG);
    if ("error" in outcome) throw new Error(outcome.error);
    expect(outcome.matchedByVin).toBe(1);
    expect(outcome.updated).toBe(0);
    expect(rec.queries.filter((q) => q.table === "fleetpal_units" && q.write).length).toBe(0);
  });

  it("⚠ asks the roster for RETIRED equipment too", async () => {
    // A truck sold in June still owns the repairs it had in May. Measured 2026-09-21: 36 of the 474
    // FleetPal units match by VIN only once the 61 retired rows are in the candidate set.
    const rec = createSupabaseRecorder({
      tables: {
        vehicles: [vehicleRow],
        trailers: [],
        fleetpal_units: () => ({ data: [unitRow()], error: null }),
      },
    });
    await resolveStagedUnits(rec.client, ORG);
    const statusFilters = rec.queries
      .filter((q) => q.table === "vehicles" || q.table === "trailers")
      .flatMap((q) => q.filters())
      .filter((f) => f.col === "status");
    expect(statusFilters).toEqual([]);
  });
});
