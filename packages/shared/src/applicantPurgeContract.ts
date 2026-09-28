import { z } from "zod";
import { isAdmin } from "./auth.js";
import type { UserRole } from "./constants.js";

/**
 * Deleting an applicant outright — Q-AW40, ruled by the owner 2026-09-28: "hard delete, admin only".
 *
 * Migration 0380's `purge_applicant` is the one door, and it refuses anybody who was ever hired
 * (§391.51 keeps a qualification file for the length of employment plus three years). This contract
 * is what the api route and the Recruitment board's drawer both read, so the gate and the typed-name
 * rule exist once.
 */

/**
 * Admin only — the ruling, read as the role and nothing else. Not `canManageSection("recruitment")`:
 * a recruiter archives an applicant (reversible, `canArchiveDriver`) and does not delete one. 0380
 * checks the same fact again in SQL against `memberships`, because the service role bypasses the rest.
 */
export const canPurgeApplicant = (role: UserRole | null | undefined): boolean => isAdmin(role);

/**
 * The name typed to confirm must be the applicant's name as the board shows it. Case and runs of
 * spaces are forgiven — the point is that the admin read WHICH person, not that they reproduced
 * capitalisation — and nothing else is: a partial name or a different person's is refused.
 */
export const normalisePurgeName = (name: string | null | undefined): string =>
  (name ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

export const purgeNameMatches = (typed: string | null | undefined, fullName: string | null | undefined): boolean => {
  const want = normalisePurgeName(fullName);
  return want.length > 0 && normalisePurgeName(typed) === want;
};

export const applicantPurgeSchema = z.object({
  confirm_name: z.string().trim().min(1, "Type the applicant's name to confirm.").max(200),
});
export type ApplicantPurge = z.infer<typeof applicantPurgeSchema>;

/**
 * What the route answers. `counts` is 0380's per-table count; `storageNotRemoved` is every Storage
 * object whose row was deleted but whose file could not be — named in the `driver.purged` audit row
 * too, so an orphan is findable rather than silent.
 */
export interface ApplicantPurgeResult {
  counts: Record<string, number>;
  storageRemoved: number;
  storageNotRemoved: string[];
  /** False when the `driver.purged` row could not be written after the delete had committed — the
   *  delete cannot be undone, so the screen says so rather than reporting a clean success. */
  audited: boolean;
}
