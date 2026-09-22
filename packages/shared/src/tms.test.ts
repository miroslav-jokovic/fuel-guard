import { describe, expect, it } from "vitest";
import { tmsLoadsPayloadSchema, tmsDispatchersPayloadSchema, deriveVehicleStatus } from "./tms.js";

/**
 * The route parses the payload with `tmsLoadsPayloadSchema.safeParse` BEFORE `ingestLoads` sees it
 * (`modules/mcleod/routes/tmsIngest.ts`), so this is the only layer where a schema default can turn
 * silence into an assertion. `tmsLoadIngest.test.ts` covers what the ingest does with the result;
 * it constructs its inputs in TypeScript and therefore cannot see this at all.
 */
const oneLoad = (over: Record<string, unknown> = {}) => ({
  loads: [{ external_id: "TMS:290227", ref: "0134754", ...over }],
});

describe("hazmat is absent, not false, when the feed says nothing (D-LM12)", () => {
  it("leaves hazmat undefined rather than defaulting it to false", () => {
    const parsed = tmsLoadsPayloadSchema.parse(oneLoad());
    const load = parsed.loads[0]!;
    // `.default(false)` here would erase a hazmat flag our own rules engine set, because `hazmat`
    // is in AMENDABLE_LOAD_FIELDS and the feed may overwrite freely before approval.
    expect(Object.hasOwn(load, "hazmat") && load.hazmat !== undefined).toBe(false);
  });

  it("still carries an explicit assertion from a feed that does know", () => {
    expect(tmsLoadsPayloadSchema.parse(oneLoad({ hazmat: true })).loads[0]!.hazmat).toBe(true);
    expect(tmsLoadsPayloadSchema.parse(oneLoad({ hazmat: false })).loads[0]!.hazmat).toBe(false);
  });
});

describe("the dispatcher a load belongs to (D-LM3)", () => {
  it("carries the McLeod dispatcher id and name through the contract", () => {
    const load = tmsLoadsPayloadSchema.parse(
      oneLoad({ dispatcher_external_id: "romann", dispatcher_name: "romann" }),
    ).loads[0]!;
    expect(load.dispatcher_external_id).toBe("romann");
  });

  it("accepts a load with no dispatcher, because an unassigned one has none", () => {
    expect(tmsLoadsPayloadSchema.parse(oneLoad()).loads[0]!.dispatcher_external_id).toBeUndefined();
  });

  it("trims the id, so a CHAR(10) column padded by McLeod matches a stored mapping", () => {
    const load = tmsLoadsPayloadSchema.parse(oneLoad({ dispatcher_external_id: "romann    " })).loads[0]!;
    expect(load.dispatcher_external_id).toBe("romann");
  });
});

describe("the dispatcher roster payload", () => {
  it("defaults a dispatcher to a real person who is active", () => {
    const d = tmsDispatchersPayloadSchema.parse({ dispatchers: [{ external_id: "kane" }] }).dispatchers[0]!;
    expect(d.is_system).toBe(false);
    expect(d.is_active).toBe(true);
  });

  it("carries is_system for the accounts that are not people", () => {
    // `loadmaster` and `lmeadm` are both named "McLeod Administrator" and held 21 of 109 active
    // loads on 2026-09-10. Those loads have no human dispatcher and must not be given one.
    const d = tmsDispatchersPayloadSchema.parse({
      dispatchers: [{ external_id: "loadmaster", display_name: "McLeod Administrator", is_system: true }],
    }).dispatchers[0]!;
    expect(d.is_system).toBe(true);
  });
});

/**
 * `deriveVehicleStatus` is the whole of E0's rule (FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md, D-FC9/D-FC10).
 * It is pure so that "which trucks are in the fleet" can be argued with here rather than in
 * production — the roster sweep had no path to a status at all until 2026-09-22, and the two values
 * it now writes had between them never appeared on a row in this database.
 */
describe("the lifecycle status a TMS row implies", () => {
  it("calls a row with no purchase date and no model year an ORDER, not a truck", () => {
    // Measured against McLeod 2026-09-22: 54 of 247 active tractors look like this — no dispatch
    // history, no gateway, one shared inservice_date. 53 of the 54 DO carry a serial number, so a VIN
    // cannot tell them apart from equipment and these two dates can.
    expect(deriveVehicleStatus({ purchased_at: null, year: null })).toBe("ordered");
  });

  it("accepts either date as evidence the truck exists", () => {
    expect(deriveVehicleStatus({ purchased_at: "2020-12-21", year: null })).toBe("active");
    expect(deriveVehicleStatus({ purchased_at: null, year: 2021 })).toBe("active");
  });

  it("puts a delivered truck the shop is holding into maintenance", () => {
    // 12 trucks on 2026-09-22. The value has sat in the `vehicle_status` enum since 0001 with nothing
    // ever writing one, which is how `equipmentInspection` came to drop them from the §396.17 roster.
    expect(deriveVehicleStatus({ purchased_at: "2020-12-21", in_shop: true })).toBe("maintenance");
  });

  it("reads a truck the carrier has not taken delivery of as ordered even if the TMS flags a shop", () => {
    // Order is load-bearing: a truck that does not exist yet cannot be in a shop, whatever sub-status
    // the row happens to be carrying.
    expect(deriveVehicleStatus({ purchased_at: null, year: null, in_shop: true })).toBe("ordered");
  });

  it("treats an ABSENT shop flag as no evidence of a shop, not as evidence of one", () => {
    // Link mode does not read the sub-status at all, so `undefined` arrives routinely and must not
    // park a running truck.
    expect(deriveVehicleStatus({ purchased_at: "2020-12-21" })).toBe("active");
    expect(deriveVehicleStatus({ purchased_at: "2020-12-21", in_shop: null })).toBe("active");
  });
});
