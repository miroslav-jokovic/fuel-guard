import type { SupabaseClient } from "@supabase/supabase-js";
import type { DrugAlcoholPolicyInfo } from "@silvicom/shared";
import { drugAlcoholPolicyPdf } from "./applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyCopy.js";
import {
  DRUG_ALCOHOL_POLICY_DOCUMENT,
  DRUG_ALCOHOL_POLICY_VERSION,
} from "./applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.js";

/**
 * The office's preview of the BLANK drug-and-alcohol policy, from Settings → Recruiting
 * (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2 DAP2's "office preview"; handoff 2026-11-04 item 8).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Since DAP2 every applicant is given the policy at page 28, but the office could read it only by opening an
 * applicant's link — and Q-DAP2 asks the owner to proofread the rendered text against the paper BEFORE a
 * release. This is the copy to proofread: the pages a driver is given, unsigned, under a DRAFT band.
 *
 * ── ONE DRAWING ───────────────────────────────────────────────────────────────────────────────
 * `drugAlcoholPolicyPdf` draws it, the function the applicant's link and the filed copy use. Passing no link
 * is what leaves the signature line blank; a second drawing for the office would be A2's defect again (an
 * office preview that does not match what the driver signs, and nothing able to see it).
 *
 * ⚠ The policy is the carrier's handout, not a record about anybody, so there is no applicant to refuse and
 * nothing to file: streamed, never stored — a preview is not evidence (`handbookPreviewPdf`'s reason). The
 * only org-specific thing on it is the carrier's name in the footer.
 */

/** The office's band — the handbook preview's words, with this document's name. */
export const DRUG_ALCOHOL_POLICY_PREVIEW_BAND = "DRAFT - NOT A SIGNED POLICY";

/** What the Settings card says about the text in use, read from the text itself — never restated in the web. */
export const drugAlcoholPolicyInfo = (): DrugAlcoholPolicyInfo => ({
  name: DRUG_ALCOHOL_POLICY_DOCUMENT.name,
  version: DRUG_ALCOHOL_POLICY_VERSION,
});

export async function drugAlcoholPolicyPreviewPdf(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ pdf: Buffer; filename: string }> {
  const pdf = await drugAlcoholPolicyPdf(admin, orgId, null, null, DRUG_ALCOHOL_POLICY_PREVIEW_BAND);
  return { pdf, filename: `drug-alcohol-policy-${DRUG_ALCOHOL_POLICY_VERSION}-preview.pdf` };
}
