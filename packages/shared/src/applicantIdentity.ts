import { z } from "zod";
import { requiredDateOfBirthSchema } from "./rosterContract.js";

/**
 * The applicant's identity, collected WITH the permissions (AF3, D-AF1, D-AF8).
 *
 * ── WHY THESE THREE, AND WHY BEFORE THE APPLICATION ───────────────────────────────────────────
 * PSP is matched on name, licence number, licence state and date of birth, and `pspOrder.ts` reads
 * the last three off `drivers`. Until the owner's order changed on 2026-09-24 those columns were
 * written only when the application was FILED (the 0231 projection), so PSP could not be ordered
 * until the driver had filled in and certified the whole form — and in the carrier's real order PSP,
 * the MVR and the Clearinghouse query all run before the application is even sent. D-AF1 moves the
 * three facts to the permissions step. (The name is already on `drivers`: the office typed it when
 * it created the applicant.)
 *
 * ── ONE WRITER (D-AF8) ────────────────────────────────────────────────────────────────────────
 * `record_applicant_identity` (0365) writes `drivers` and the draft together, and the draft receives
 * whatever ended up on the row. These are the draft keys it writes, and they are
 * `driverApplicationSchema`'s own names, so the form reads them with no mapping at all.
 */
export const APPLICANT_IDENTITY_KEYS = ["date_of_birth", "cdl_number", "cdl_state"] as const;
export type ApplicantIdentityKey = (typeof APPLICANT_IDENTITY_KEYS)[number];

/**
 * What the applicant (and the office's correction) submits.
 *
 * ⚠ The bounds are `applicationContract.ts`'s for the same three fields, and deliberately the same:
 * a value accepted here and refused by the application at filing would strand the applicant at the
 * certification with an answer they are not allowed to change. `.trim()` because the SQL trims too,
 * and a licence number that is only whitespace is not a licence number.
 */
export const applicantIdentitySchema = z.object({
  date_of_birth: requiredDateOfBirthSchema,
  cdl_number: z.string().trim().min(1).max(60),
  cdl_state: z.string().trim().min(2).max(10),
});
export type ApplicantIdentity = z.infer<typeof applicantIdentitySchema>;

/**
 * Does this draft carry all three? Structurally, because the draft is unvalidated by design.
 *
 * ⚠ It answers from the KEYS and hands back a boolean, never a value: D-APP16 keeps the date of
 * birth off the bare link, and a caller asking "is identity complete?" has no business being told
 * what it is.
 */
export function draftIdentityComplete(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return APPLICANT_IDENTITY_KEYS.every((k) => typeof p[k] === "string" && (p[k] as string).trim() !== "");
}
