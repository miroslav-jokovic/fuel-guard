import type { HiringChecklist } from "./hiringChecklist.js";

/**
 * Is this applicant READY TO SCREEN — they have done everything they can alone, and the office has
 * filed nothing yet (APPLICATION-FLOW-V2-PLAN Q-AW56)?
 *
 * ── THE RULE, AND WHY IT READS THE FOLD AND NOT A STAMP ────────────────────────────────────────
 * Two things, both read off the fold's own states so this cannot disagree with the board's `next`:
 * the permissions are signed (the office may pull an MVR and order PSP only on their strength,
 * `SCREENING_PREREQUISITES`), and no screening step the office owes is done. While both hold the
 * fold's lead step is necessarily the MVR — it follows the permissions in D-HM9's order and nothing
 * else can be in front of it — so "the next move is the office's" is implied and not restated: a
 * third clause saying so was written first and no test could make it decide anything (mutation,
 * 2026-10-20), which is how a redundant rule announces itself.
 *
 * ⚠ Why not `releases_completed_at` alone: the stamp says the applicant finished; it does not say the
 * office has not started, and a flag that stayed up through the MVR and the PSP would count the
 * office's own work as its backlog. Measured need (production, 2026-10-20): two applicants sat in
 * exactly this state for nineteen days with nothing counting them.
 *
 * ⚠ The flag means "nothing FILED", not "nothing touched", and stays up through two office acts the
 * fold cannot see as screening: a drug test ORDERED (the evidence is the result, D-AW6) and the
 * application SENT without a record pulled first. Both are right — the MVR is still the office's
 * move, and sending the form screens nobody.
 *
 * ⚠ "Screening the office owes" is the BEFORE-TRAVEL half of the phase — the MVR, PSP, the
 * Clearinghouse query, the medical certificate — and not `travel_booked`, which carries the same
 * phase and owner (§7) but is the office's move AFTER screening. Without that word a booked ticket
 * read as a filed screening record: found by the board's own test on 2026-10-20, where the fixture's
 * trip turned the flag off for an applicant nobody had screened.
 */
export function readyToScreen(checklist: Pick<HiringChecklist, "steps">): boolean {
  const permissions = checklist.steps.find((s) => s.key === "permissions_signed");
  if (permissions?.state !== "done") return false;
  const officeScreening = checklist.steps.filter((s) => s.phase === "screening" && s.owes === "us" && s.beforeTravel);
  return !officeScreening.some((s) => s.state === "done");
}
