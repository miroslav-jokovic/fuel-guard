import type { DriverApplicationFields } from "./applicationContract.js";
import type { ApplicationFilingIssue } from "./applicationFilingRules.js";

/**
 * The filed §391.21 application of a v2 invitation: what the applicant certified, with Part 1's facts
 * laid over it (D-AW3, AW2, C2c).
 *
 * ── WHY PART 1 WINS WHERE THE TWO OVERLAP ─────────────────────────────────────────────────────
 * D-AW3 moved the applicant's contact, current address, licences and §40.25(j) answer out of the
 * draft into `application_intakes` / `application_intake_licences`, because those are what screening
 * READ: the MVR was ordered per licence on that list (AW7), PSP matched on position 0, and the office
 * may have corrected a licence there (`record_applicant_intake`'s `p_overwrite`). A filed document
 * that restated the same facts from a draft the applicant retyped could name a licence nobody
 * checked — the disagreement D-AF8 exists to rule out, one table further along. So the certified
 * document carries Part 1's values, and a v2 Part 2 never has to ask for them again (C3).
 *
 * ── WHAT IT DOES NOT TOUCH ────────────────────────────────────────────────────────────────────
 * Date of birth and the primary licence's number and state are laid over by `identityOnRecord` AFTER
 * this, from `drivers` — which `record_applicant_intake` writes from position 0, so the two agree,
 * and where they do not the office's later correction on the row is the one that stands (AF3).
 * The address HISTORY's dates stay the applicant's: Part 1 records where they live, not since when.
 *
 * ⚠ A legacy invitation (no Part 1 row — plan §7) never reaches this and files exactly what it did.
 */

/** One `application_intakes` row, as far as the filed document reads it. */
export interface PartOneFacts {
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  prior_positive_2y: boolean | null;
}

/** One `application_intake_licences` row. Position 0 is the current CDL. */
export interface PartOneLicence {
  position: number;
  state_code: string;
  agency: string | null;
  licence_number: string;
  expires_on: string | null;
}

type Composable = Pick<
  DriverApplicationFields,
  "phone" | "addresses" | "cdl_number" | "cdl_state" | "cdl_expires_at" | "additional_licences"
  | "prior_failed_pre_employment_test"
>;

const filled = (v: string | null): v is string => v !== null && v.trim() !== "";

export function composeFiledApplication<T extends Composable>(
  application: T,
  intake: PartOneFacts,
  licences: readonly PartOneLicence[],
  asOf: string,
): { application: T; issues: ApplicationFilingIssue[] } {
  const issues: ApplicationFilingIssue[] = [];
  const out: T = { ...application };

  if (filled(intake.phone)) out.phone = intake.phone;

  /**
   * The CURRENT address (`to` empty) takes Part 1's street, keeping the month the applicant said they
   * moved in. ⚠ A history with no current entry is left alone rather than given one: its `from` is a
   * fact only the applicant has, and inventing it would put a date on a certified document nobody gave.
   */
  if (filled(intake.address_line1) && filled(intake.city) && filled(intake.state) && filled(intake.postal_code)) {
    out.addresses = application.addresses.map((a) => (a.to ? a : {
      ...a,
      line1: intake.address_line1!,
      line2: intake.address_line2,
      city: intake.city!,
      state: intake.state!,
      postal_code: intake.postal_code!,
    }));
  }

  const ordered = [...licences].sort((a, b) => a.position - b.position);
  const [current, ...others] = ordered;
  if (current && current.position === 0) {
    out.cdl_number = current.licence_number;
    out.cdl_state = current.state_code;
    if (current.expires_on) out.cdl_expires_at = current.expires_on;
  }
  /**
   * (b)(5) asks for each UNEXPIRED licence or permit, so the list Part 1 took — every licence held in
   * three years, because the MVR needs the expired ones too — is cut to those still valid on the
   * application's date. It REPLACES the draft's list, never joins it: C2b3's rule for the MVR's
   * jurisdictions ("the first that has any, never a union"), and for the same reason — two lists of
   * one fact disagree, and a union files both.
   *
   * ⚠ A licence with no expiry cannot be sorted either way and cannot be filed ((b)(5) names the
   * expiration date), so it is an issue for the applicant to answer, never a silent drop.
   */
  if (ordered.length > 0) {
    out.additional_licences = [];
    others.forEach((l) => {
      if (!l.expires_on) {
        issues.push({ path: "additional_licences", message: `Give the expiry date of your ${l.state_code} licence` });
        return;
      }
      if (l.expires_on < asOf) return;
      out.additional_licences.push({
        issuing_authority: l.agency ?? l.state_code,
        number: l.licence_number,
        expires_at: l.expires_on,
        kind: null,
      });
    });
  }

  // D-AW13: §40.25(j) is asked once, in Part 1, where AI009 refuses an intake without it.
  if (intake.prior_positive_2y !== null) out.prior_failed_pre_employment_test = intake.prior_positive_2y;

  return { application: out, issues };
}
