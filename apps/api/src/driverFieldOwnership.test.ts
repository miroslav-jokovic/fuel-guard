import { describe, expect, it } from "vitest";
import {
  DRIVER_INLINE_EDITABLE,
  DRIVER_IDENTITY_FIELDS,
  DRIVER_LIFECYCLE_FIELDS,
  isDriverInlineEditable,
} from "@silvicom/shared";
import { driverPatch } from "./modules/mcleod/rosterFields.js";

/**
 * `DRIVER_INLINE_EDITABLE` is a claim about the SYNCS, and this is where it can be checked (D-ROS2,
 * §6 Q4).
 *
 * A field is editable in place only if no sync owns it. That is not a fact about the shared package —
 * it is a fact about `mcleod/rosterFields.ts` and `samsaraDriverSync.ts`, which live here. So the
 * list is declared in `@silvicom/shared`, where both the web and the API can read it, and VERIFIED
 * here against the real writers.
 *
 * ⚠ It lives at `src/` rather than under `modules/roster/`, and `lint:boundaries` is why: a module
 * may not import a sibling's internals, and this assertion is ABOUT two modules agreeing — it is
 * neither module's own. That is the same reason `routeAuth.test.ts` and `routeGates.test.ts` sit
 * here. The gate refused the first placement, correctly.
 *
 * The failure this prevents is quiet: McLeod adds `eld_id` to its sweep, the roster keeps offering it
 * as a plain text box, and every value typed there reverts overnight with nothing logged. That is the
 * same shape as the defect R6a fixed, and it would arrive without anybody editing this file.
 */

/** Every key McLeod's sweep will write, from the function that writes them. */
const mcleodWritten = new Set(
  Object.keys(
    driverPatch({
      first_name: "A", middle_name: "B", last_name: "C",
      cdl_number: "X", cdl_state: "IL", cdl_expires_at: "2030-01-01",
      medical_card_expires_at: "2030-01-01", hire_date: "2020-01-01", date_of_birth: "1980-01-01",
      email: "a@b.test", address_line1: "1 Road", city: "Joliet", state: "IL", postal_code: "60432",
    } as Parameters<typeof driverPatch>[0]),
  ),
);

/**
 * Samsara's written set, read off `samsaraDriverSync.ts` rather than retyped: `identity` is
 * full_name + samsara_driver_id, plus phone and samsara_username when present, and `licence` seeds
 * cdl_number/cdl_state on a row that has none.
 */
const SAMSARA_WRITTEN = [
  "full_name", "samsara_driver_id", "phone", "samsara_username", "cdl_number", "cdl_state",
];

describe("DRIVER_INLINE_EDITABLE — no sync owns any of it", () => {
  it("finds the McLeod writer, so this file cannot pass by checking nothing", () => {
    expect(mcleodWritten.size).toBeGreaterThan(10);
    expect(mcleodWritten.has("cdl_number")).toBe(true);
  });

  it("shares no field with McLeod's sweep", () => {
    const overlap = DRIVER_INLINE_EDITABLE.filter((f) => mcleodWritten.has(f));
    expect(overlap, "McLeod would revert these overnight").toEqual([]);
  });

  it("shares no field with the Samsara sync", () => {
    const overlap = DRIVER_INLINE_EDITABLE.filter((f) => SAMSARA_WRITTEN.includes(f));
    expect(overlap, "Samsara would revert these, or the edit would claim the row").toEqual([]);
  });
});

describe("DRIVER_INLINE_EDITABLE — nothing legal turns on any of it", () => {
  it("excludes every identity field, because editing one claims the row permanently", () => {
    const overlap = DRIVER_INLINE_EDITABLE.filter((f) => (DRIVER_IDENTITY_FIELDS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it("excludes the lifecycle fields, which move the §391.51(c) retention clock", () => {
    const overlap = DRIVER_INLINE_EDITABLE.filter((f) => (DRIVER_LIFECYCLE_FIELDS as readonly string[]).includes(f));
    expect(overlap).toEqual([]);
  });

  it("excludes dates of birth, licences, medical cards and money", () => {
    // Screening identity, what an auditor reads, and compensation. Each is an edit somebody should
    // have to mean, not one a text box performs on blur.
    for (const field of DRIVER_INLINE_EDITABLE) {
      expect(field).not.toMatch(/^(cdl_|medical_|pay_|date_of_birth|hire_date|settlement_)/);
    }
  });

  it("answers for a field by name rather than by a hand-written check at a call site", () => {
    expect(isDriverInlineEditable("phone_alt")).toBe(true);
    // Safe on both counts, but the roster drawer already owns it — see the list's own note.
    expect(isDriverInlineEditable("employee_id")).toBe(false);
    expect(isDriverInlineEditable("full_name")).toBe(false);
    expect(isDriverInlineEditable("nonsense")).toBe(false);
  });
});

/**
 * §6 Q8's answer, made checkable: no field is editable in two places.
 *
 * The roster's drawer (`DriverForm`) edits name, employee id, phone and status — the dangerous ones,
 * where it warns before it claims and reports what the edit meant (R6a). The record page edits
 * `DRIVER_INLINE_EDITABLE` in place. If a field ever appears in both, the product has two editors for
 * it with two different amounts of honesty, and which one a person used becomes a matter of where
 * they happened to click. That is the duplication D-ROS11 exists to prevent, and it is the reason
 * R6b did not build the six editable sections its prose imagined.
 */
const DRAWER_FIELDS = ["full_name", "employee_id", "phone", "status"];

describe("no driver field is editable in two places (Q8)", () => {
  it("the drawer and the record page do not both offer the same field", () => {
    const both = DRIVER_INLINE_EDITABLE.filter((f) => DRAWER_FIELDS.includes(f));
    expect(both, "these fields would have two editors with two different warnings").toEqual([]);
  });
});
