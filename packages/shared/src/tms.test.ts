import { describe, expect, it } from "vitest";
import { tmsLoadsPayloadSchema, tmsDispatchersPayloadSchema } from "./tms.js";

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
