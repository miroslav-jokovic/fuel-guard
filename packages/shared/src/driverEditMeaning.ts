import { z } from "zod";
import { driverDetailSchema, DRIVER_IDENTITY_FIELDS } from "./rosterContract.js";

/**
 * What a driver edit MEANS — the half of the roster contract that is about consequences rather than
 * shapes (R6a/R6c, D-ROS2/D-ROS4).
 *
 * Split out of `rosterContract.ts` when that file reached 527 lines against the 500-line budget
 * (`lint:filesize`). The seam is not arbitrary: everything here answers "what does this edit do to
 * the row", where the rest of that file answers "what shape may cross the wire". The two are read at
 * different moments — one by a form deciding whether to warn, the other by a route deciding whether
 * to accept.
 */
/**
 * What `PATCH /api/roster/drivers/:id` answers with (R6a).
 *
 * ── WHY THE FLAGS ARE IN THE RESPONSE AND NOT ONLY IN THE AUDIT LOG ─────────────────────────────
 * `resolveDriverUpdate` computes two facts an edit can be true of, and both change what the row
 * MEANS rather than merely what it says: the edit claimed the driver away from telematics, and the
 * edit started the §391.51(c) retention clock. Until R6a both were written to `audit_logs.meta` and
 * to nowhere else — recorded for an auditor, invisible to the person who caused them.
 *
 * D-ROS1 refused a cell-editor grid precisely because "a cell editor has nowhere to put that
 * sentence". A sentence with nowhere to come FROM is the same gap from the other end.
 */
export const driverUpdateResponseSchema = z.object({
  driver: driverDetailSchema,
  /** The edit claimed a telematics-owned row for the office (identity_source → 'manual'). */
  claimedFromTelematics: z.boolean(),
  /** The edit stamped today as the termination date, because the caller sent none. */
  stampedTerminationDate: z.boolean(),
});
export type DriverUpdateResponse = z.infer<typeof driverUpdateResponseSchema>;

/**
 * Would this patch claim the row from telematics? Answerable BEFORE Save, from what the form knows.
 *
 * The same two inputs `resolveDriverUpdate` uses server-side, so the warning a person reads and the
 * flag the server returns cannot disagree — which they would the moment either side kept its own
 * list of identity fields.
 */
export function wouldClaimFromTelematics(
  changedFields: readonly string[],
  identitySource: string | null | undefined,
): boolean {
  if (!identitySource || identitySource === "manual") return false;
  return DRIVER_IDENTITY_FIELDS.some((f) => changedFields.includes(f));
}

/**
 * The driver fields a reader may edit IN PLACE, without a warning and without a claim (D-ROS2, Q4).
 *
 * ── THE TWO TESTS A FIELD HAS TO PASS ───────────────────────────────────────────────────────────
 * **No sync owns it.** McLeod's `driverPatch` refreshes name, licence, medical card, hire date, date
 * of birth, email and address on every sweep; Samsara writes `full_name`, `phone` and
 * `samsara_username`, and seeds `cdl_number`/`cdl_state` when empty. Editing any of those either
 * reverts on the next sweep or claims the row away from the sync permanently — neither is something
 * a text box should do quietly. `driverFieldOwnership.test.ts` in `apps/api` asserts this list does
 * not intersect either sync's written set, so a field McLeod starts writing FAILS rather than
 * silently becoming a lie.
 *
 * **Nothing legal turns on it.** `status` and `termination_date` move the §391.51(c) retention
 * clock; `date_of_birth` is screening identity; `cdl_*` and `medical_*` are what an auditor reads;
 * `pay_*` and `settlement_company` are money. Those are edits somebody should have to mean.
 *
 * ── WHERE EACH KIND OF EDIT LIVES, WHICH IS THE ANSWER TO Q8 ────────────────────────────────────
 * These fields are editable on the RECORD PAGE, in place. Everything dangerous — the identity fields
 * and the lifecycle fields — stays in the roster's drawer, which warns before it claims and reports
 * what the edit meant afterwards (R6a). **No field is editable in two places**, which is the whole
 * point: a second editor for the same field is the duplication D-ROS11 exists to prevent, and
 * `DRIVER_INLINE_EDITABLE` is the boundary between the two surfaces rather than a third opinion.
 *
 * ⚠ **`employee_id` is NOT here, and it passes both tests above.** It has no sync owner and nothing
 * legal turns on it — but the roster's drawer already edits it, and it is needed there because that
 * drawer also CREATES drivers. So this list is not "fields that would be safe to edit in place"; it
 * is "fields the record page owns", and a field that already has an editor does not get a second
 * one. The first draft had it in both, and "the drawer and the record page do not both offer the
 * same field" in `apps/api/src/driverFieldOwnership.test.ts` is what caught it.
 */
export const DRIVER_INLINE_EDITABLE = [
  "phone_alt",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relation",
  "eld_id",
] as const;
export type DriverInlineEditableField = (typeof DRIVER_INLINE_EDITABLE)[number];

/** True when this field may be edited in place. Never a hand-written check at a call site. */
export const isDriverInlineEditable = (field: string): field is DriverInlineEditableField =>
  (DRIVER_INLINE_EDITABLE as readonly string[]).includes(field);
