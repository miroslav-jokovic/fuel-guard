import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DRIVER_IDENTITY_FIELDS } from "@silvicom/shared";
import { vehiclePatch, trailerPatch } from "./rosterFields.js";

/**
 * The claim trigger's column list and the sync's write list must be the same set.
 *
 * 0241 protects an office edit by flipping `identity_source` to 'manual' when a human changes a
 * column the sync owns. That is only correct while the two lists agree, and they live in different
 * languages in different directories — the kind of correspondence that rots the first time somebody
 * adds a field to the McLeod mapping and does not think about the trigger.
 *
 * Both failure directions are real and neither raises on its own:
 *   · a column the sync writes but the trigger omits → the office corrects it and McLeod reverts it
 *     on the next sweep, which is exactly the DQ1 failure D-MR6's escape hatch exists to prevent;
 *   · a column the trigger claims but the sync never writes → an unrelated edit silently freezes the
 *     whole row, and McLeod stops refreshing a licence or a registration nobody asked it to stop.
 *
 * The migrations are scanned rather than one file being named, so a later migration that re-attaches
 * a trigger is the one this checks.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../../../supabase/migrations");

/** The argument list of the LAST `create trigger … claim_identity_for_office(…)` for a table. */
function triggerColumns(table: string): string[] {
  const re = new RegExp(
    String.raw`create trigger\s+\S+[\s\S]*?on public\.${table}\b[\s\S]*?execute function public\.claim_identity_for_office\(([^)]*)\)`,
    "gi",
  );
  let found: string[] | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of sql.matchAll(re)) {
      found = [...m[1]!.matchAll(/'([^']+)'/g)].map((a) => a[1]!);
    }
  }
  if (!found) throw new Error(`no claim trigger found for ${table}`);
  return found;
}

/** Every optional field populated, so the patch builder emits its complete column set. */
const FULL_VEHICLE = {
  external_id: "104",
  vin: "1FUJGLD54LLAA1234",
  unit_number: "104",
  make: "Freightliner",
  model: "Cascadia",
  year: 2021,
  plate: "ABC123",
  plate_state: "MT",
  registration_expires_at: "2027-01-31",
  annual_inspection_performed_at: "2026-03-04",
  purchased_at: "2019-06-01",
};
const FULL_TRAILER = {
  external_id: "532159",
  vin: "1UYVS2536MU123456",
  unit_number: "532159",
  make: "Utility",
  year: 2019,
  plate: "TR9021",
  plate_state: "MT",
  is_reefer: true,
  purchased_at: "2018-04-20",
  annual_inspection_performed_at: "2026-02-11",
  axle_count: 2,
};

/**
 * ── THE ONE COLUMN THE SYNC WRITES AND THE TRIGGER DELIBERATELY DOES NOT CLAIM ──────────────────
 * `status` joined `vehiclePatch` on 2026-09-22 (E0) and is NOT in 0241's argument list, which the set
 * comparison below would otherwise read as the first failure direction. It is the second one that
 * applies here, and it is worse:
 *
 * The claim is WHOLE-ROW. A truck whose status somebody touched in the office would stop receiving
 * its VIN, plate, registration and inspection date from McLeod — for good, for a field McLeod is the
 * declared master of (D-FC0: "we follow the source McLeod"). That is the same shape as the defect
 * 0286 had to unpick, where one certified inspection cost a trailer its VIN for a whole sweep, and
 * the fix there was to scope the claim to one column rather than to widen it.
 *
 * So a hand-edited vehicle status is expected to be overwritten by the next sweep, and that is a
 * position rather than an oversight. It does leave `VehicleForm.vue` offering a status field whose
 * value the sweep may revert within the hour — recorded as an open question on the plan rather than
 * papered over here, because the honest answers (drop the field, or give status its own `*_source`
 * column the way 0286 did) are both larger than this merge.
 */
const NOT_CLAIMED = new Set(["status"]);

describe("0241's claim trigger covers exactly what the McLeod sync writes", () => {
  it("vehicles", () => {
    const written = Object.keys(vehiclePatch(FULL_VEHICLE)).filter((c) => !NOT_CLAIMED.has(c));
    expect(new Set(triggerColumns("vehicles"))).toEqual(new Set(written));
  });

  it("names every carve-out — a column excused here must actually be written", () => {
    // Otherwise the exclusion list becomes a place to hide a column that no longer exists, and the
    // parity check quietly stops covering the thing it is named for.
    const written = new Set(Object.keys(vehiclePatch(FULL_VEHICLE)));
    for (const column of NOT_CLAIMED) expect(written.has(column)).toBe(true);
  });

  it("trailers", () => {
    expect(new Set(triggerColumns("trailers"))).toEqual(new Set(Object.keys(trailerPatch(FULL_TRAILER))));
  });

  it("drivers mirror DRIVER_IDENTITY_FIELDS, so PostgREST and resolveDriverUpdate agree", () => {
    // Deliberately NOT driverPatch: D-MR6 decided the licence and medical dates revert rather than
    // claim, and the trigger must reach the same verdict the API route reaches on the same edit.
    expect(new Set(triggerColumns("drivers"))).toEqual(new Set(DRIVER_IDENTITY_FIELDS));
  });
});
