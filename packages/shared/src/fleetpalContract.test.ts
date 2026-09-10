import { describe, expect, it } from "vitest";
import manifest from "./fleetpal/fieldManifest.generated.json" with { type: "json" };
import {
  FLEETPAL_ENUMS,
  METRES_PER_MILE,
  fleetpalDefectSchema,
  fleetpalIntervalSchema,
  fleetpalJobItemSchema,
  fleetpalPartSchema,
  fleetpalPoInvoiceSchema,
  fleetpalPoReceiptItemSchema,
  fleetpalServiceHistorySchema,
  fleetpalUnitSchema,
  fleetpalWorkOrderSchema,
  metresToMiles,
  money,
  paginated,
} from "./fleetpalContract.js";

/**
 * The FleetPal contracts (FLEETPAL-INTEGRATION-PLAN.md step F1).
 *
 * `check-fleetpal-contract.mjs` already proves the schemas cover the spec's field names, and
 * repeating that here would be a second copy of one check. What this file pins is the part a field
 * list cannot express: the four wire conventions that are wrong-by-default, and the tolerance
 * properties that keep an additive vendor change from becoming an outage.
 *
 * Every fixture below is shaped from the vendor's own documented examples rather than invented, so
 * that F4 — which replaces these with recorded payloads from the live account — is a substitution
 * and not a rewrite.
 */

describe("the wire conventions", () => {
  it("reads a distance as metres, so a truck at 412,000 miles is not 412,000 anything else", () => {
    // A truck showing 412,000 on its dash reads 663,049,728 here. The vendor's own validation
    // example — "Value must be greater than or equal to 412000" — is a METRE bound, which is 256
    // miles: reading it as miles would make a plausible-looking limit that is nothing of the kind.
    expect(Math.round(metresToMiles(663_049_728))).toBe(412_000);
    expect(Math.round(metresToMiles(412_000))).toBe(256);
    expect(METRES_PER_MILE).toBe(1609.344);
  });

  it("reads money as currency units, so 125.5 is $125.50 and never 125 cents", () => {
    expect(money.parse(125.5)).toBe(125.5);
    // Three decimal places are documented as valid, and must survive rather than round.
    expect(money.parse(0.125)).toBe(0.125);
  });

  it("refuses a money value that cannot reach a numeric column", () => {
    // zod 4 rejects both without `.finite()`, which is deprecated there — primitives.ts says so and
    // this is what makes that claim checkable rather than remembered.
    expect(money.safeParse(NaN).success).toBe(false);
    expect(money.safeParse(Infinity).success).toBe(false);
  });

  it("keeps a job item's five types apart, because quantity means hours on only one of them", () => {
    const labor = fleetpalJobItemSchema.parse({
      url: "u", id: "J1", job: "j", type: "LABOR", description: "Diagnose",
      part: null, part_number: null, universal_product_code: null, manufacturer: null,
      manufacturer_part_number: "", component: "013", cause: null, unit_of_measure: "hr",
      quantity: 2.5, price: 120, total: 300, created: "2026-08-14T09:30:00Z",
      updated: "2026-08-14T09:30:00Z",
    });
    expect(labor.unit_of_measure).toBe("hr");
    expect(labor.quantity).toBe(2.5);
  });
});

describe("tolerance — an additive vendor change must not take the feed down", () => {
  /**
   * ⚠ THE ASSERTION THIS FILE EXISTS FOR. Within v1 the vendor adds endpoints, optional request
   * fields and response fields, and instructs consumers to ignore unrecognised fields rather than
   * reject them. A strict object would turn a change they told us to expect into an outage, and a
   * zod-4 default object would strip the field silently — which is worse, because the ingest would
   * write a row that looks complete.
   */
  it("keeps a response field the vendor added and we have never seen", () => {
    const parsed = fleetpalUnitSchema.parse({
      url: "https://openapi.fleetpal.io/v1/units/Vn7kPq2R", id: "Vn7kPq2R", name: "654",
      number: "654", vin: "1FUJGLDR8CLBP8834", license_plate: "P123456", color: "White",
      model: "Cascadia", model_year: 2022, serial_number: "", ownership: "OWN", owner: null,
      engine_hp: 505, engine_model: "DD15", engine_serial_number: "", engine_vmrs_manufacturer: null,
      tire_size: "295/75R22.5", transmission_gears: 12, transmission_model: "DT12",
      transmission_serial_number: "", transmission_vmrs_manufacturer: null,
      vmrs_equipment_category: "C1", vmrs_manufacturer: "M9", archived: null,
      created: "2026-01-02T00:00:00Z", updated: "2026-08-14T09:30:00Z",
      telematics_provider: "samsara",
    });
    expect((parsed as Record<string, unknown>).telematics_provider).toBe("samsara");
  });

  it("accepts a work-order status nobody has written a branch for", () => {
    const wo = fleetpalWorkOrderSchema.parse({
      url: "u", id: "W1", number: 41, reference_number: "SHOP-41", status: "AWAITING_PARTS",
      unit: "Vn7kPq2R", shop: "S1", priority: "HIGH", repair_priority_class: "NON_SCHEDULED",
      description: "", scheduled_start: null, started: null, expected_completion: null,
      completed: null, cancellation_reason: "", created: "2026-08-01T00:00:00Z",
      updated: "2026-08-01T00:00:00Z",
    });
    expect(wo.status).toBe("AWAITING_PARTS");
  });

  it("pins every vocabulary against the manifest, so an added member is noticed rather than swallowed", () => {
    // The pair to the assertion above: the parser tolerates a new member, and this is what makes
    // somebody LOOK at it. Without both, tolerance would be indistinguishable from not caring.
    for (const [name, members] of Object.entries(manifest.enums)) {
      const ours = FLEETPAL_ENUMS[name];
      expect(ours, `${name} has no FLEETPAL_* const`).toBeDefined();
      expect([...ours!].sort()).toEqual([...members].sort());
    }
  });
});

describe("the shapes that carry a null with a meaning", () => {
  it("reads a service-history total as null rather than zero", () => {
    const row = fleetpalServiceHistorySchema.parse({
      id: "H1", work_order: "W1", work_order_reference: "SHOP-41", unit: "Vn7kPq2R",
      unit_owner_name: "Silvicom, Inc.", shop: "S1", customer: null, vendor: null,
      started: "2026-08-01T00:00:00Z", completed: "2026-08-02T00:00:00Z", name: "PM A",
      description: "", source: "PM_SCHEDULE", component: "042", reason_for_repair: null,
      complaint: null, pm_schedule: "P1", defect: null, issue: null, billable: false,
      items_count: 0, total: null, total_parts: null, total_labor: null, total_fees: null,
      total_tax: null, total_services: null, total_labor_hours: null, odometer: null,
      engine_hours: null, hubometer: null, apu_hours: null,
      created: "2026-08-02T00:00:00Z", updated: "2026-08-02T00:00:00Z",
    });
    // A cost-per-mile over a null odometer is the plausible-but-wrong figure D-FIN10 refuses; the
    // contract must be able to say "unknown", which a zero cannot.
    expect(row.odometer).toBeNull();
    expect(row.total).toBeNull();
  });

  it("keeps the dvir ids nothing can resolve, rather than dropping them", () => {
    const d = fleetpalDefectSchema.parse({
      url: "u", id: "D1", unit: "Vn7kPq2R", dvirs: ["V1", "V2"], name: "Air leak",
      description: null, severity: "MAJOR", component: "013", complaint: null,
      detected_on: "2026-08-01T00:00:00Z", is_resolved: false, resolved_on: null,
      driver_comment: null, repair_note: null,
    });
    // There is no /v1/dvirs endpoint (§2.10.1). Two ids here means the defect was carried across
    // two inspections, which is evidence about how long it went unrepaired even though the reports
    // themselves cannot be opened.
    expect(d.dvirs).toEqual(["V1", "V2"]);
  });

  it("keeps a part with no number, because the catalogue allows one", () => {
    const p = fleetpalPartSchema.parse({
      url: "u", id: "P1", number: null, description: "Air filter", type: 1,
      universal_product_code: "", component: "042", manufacturer: null,
      manufacturer_part_number: "", unit_of_measure: "ea", position_applicable: false,
      serialized_part: false, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z",
    });
    expect(p.number).toBeNull();
  });

  it("reads a pm interval's threshold fields as nullable, since a meter interval has no time type", () => {
    const i = fleetpalIntervalSchema.parse({
      id: "I1", type: "ODOMETER", value_int: 64_373_760, value_time_type: null,
      threshold_int: 1_609_344, threshold_time_type: null, last_done_meter_value: 663_000_000,
      order: 0,
    });
    // 40,000 miles between services, warned at 1,000 — both canonical metres.
    expect(Math.round(metresToMiles(i.value_int!))).toBe(40_000);
    expect(i.value_time_type).toBeNull();
  });
});

describe("the coverage bridge and the shelf, which are what two of these shapes exist for", () => {
  it("carries the vendor invoice number AND the vendor, because the number alone is not unique", () => {
    const inv = fleetpalPoInvoiceSchema.parse({
      url: "u", id: "V1", purchase_order: "PO1", type: "CREDIT", number: "1001",
      date: "2026-08-10T00:00:00Z", amount: 250.75, payable_to: "VEND9", payment_term: null,
      created: "2026-08-10T00:00:00Z", updated: "2026-08-10T00:00:00Z",
    });
    // Match against mcleod_ap_vouchers on the PAIR. A tyre shop's 1001 is not a parts supplier's.
    expect([inv.payable_to, inv.number]).toEqual(["VEND9", "1001"]);
    // ⚠ A CREDIT carries a POSITIVE amount — the type is what makes it a credit, not the sign.
    // Summing amounts without reading the type overstates spend by twice every credit note.
    expect(inv.amount).toBeGreaterThan(0);
    expect(inv.type).toBe("CREDIT");
  });

  it("distinguishes a delivery that arrived from one written off, which is not a shelf event", () => {
    const base = {
      url: "u", receipt: "R1", purchase_order_item: "POI1", quantity: 24, price: 4.25,
      total: 102, created: "2026-08-11T00:00:00Z",
    };
    expect(fleetpalPoReceiptItemSchema.parse({ ...base, id: "RI1", type: "RECEIVE" }).type).toBe("RECEIVE");
    expect(fleetpalPoReceiptItemSchema.parse({ ...base, id: "RI2", type: "CANCEL" }).type).toBe("CANCEL");
    // F13 writes a `received` movement for the first and nothing at all for the second: both reduce
    // what is on order, and only one means stock physically arrived.
  });
});

describe("the list envelope", () => {
  it("carries next, which is the only correct way to walk a collection", () => {
    const page = paginated(fleetpalPartSchema.pick({ id: true })).parse({
      count: 1284,
      next: "https://openapi.fleetpal.io/v1/parts?limit=50&offset=100",
      previous: null,
      results: [{ id: "P1" }],
    });
    // Offset arithmetic silently skips and repeats: the vendor orders newest-first and rows added
    // mid-walk shift items between pages.
    expect(page.next).toContain("offset=100");
    expect(page.previous).toBeNull();
  });
});
