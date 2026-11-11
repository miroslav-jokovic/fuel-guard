import type { ApplicationContactMove } from "@silvicom/shared";
import type { FactRow } from "./applicantFactRows";

/**
 * What the card tells the office about how the carrier reaches the applicant, before and after it
 * corrects their email or phone (APPLICATION-FIX-PLAN F3c part 2, E3; `applicantContactMove.ts` on the
 * API is what actually moves). The plan's words: "update the invitation's contact and say so".
 *
 * ⚠ Said BEFORE Save as well as after. A recruiter fixing a typo in a phone number is not expecting it
 * to stop the applicant's texts, and an act they are told about only afterwards is one they did not
 * choose — so the editor says what Save will do, in the row, while it can still be cancelled.
 */
export interface ReachedAt {
  email: string | null;
  phoneTexted: boolean;
}

const isAt = (row: FactRow, head: string): boolean => row.path.length === 1 && row.path[0] === head;

/** The line under the editor, or null when the answer reaches nobody. */
export function contactNotice(row: FactRow, reached: ReachedAt | undefined): string | null {
  if (!reached) return null; // an API before E3: it moves nothing, so the card promises nothing
  if (isAt(row, "email")) {
    return reached.email
      ? `Emails about this application go to ${reached.email}. Saving sends them to the new address instead.`
      : "Saving also sends their emails about this application to this address.";
  }
  if (isAt(row, "phone") && reached.phoneTexted) {
    return "They get texts at this number. Saving stops them — they can agree to texts at the new number on their own application link.";
  }
  return null;
}

/** The toast's second line after a save: what moved, or the usual promise when nothing did. */
export function contactToast(moved: ApplicationContactMove | void | undefined): string {
  const said = ["The applicant is shown this change before they sign."];
  if (moved?.emailMoved) said.push("Their emails now go to the new address.");
  if (moved?.textsStopped) said.push("Texts to the old number have stopped.");
  return said.join(" ");
}
