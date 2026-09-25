/**
 * An MVR from every jurisdiction that licensed the driver — §391.23(a)(1), AF7
 * (`APPLICANT-FLOW-PLAN.md` §4).
 *
 * ── WHAT THE REGULATION ASKS, AND WHAT ONE ROW COULD NOT SAY ──────────────────────────────────
 * §391.23(a)(1) wants "an inquiry … to the appropriate agency of every State in which the driver
 * held or holds a motor vehicle operator's license or permit during the preceding 3 years". Until
 * AF7 the checklist asked only "is there an MVR row", so a driver licensed in two states went green
 * on one state's record. The fix is not a second kind: it is the jurisdiction written onto each
 * recorded MVR (`detail.jurisdiction`, `hiringEvidenceDetail`) and compared here with the licences
 * the applicant declared.
 *
 * ── WHY TRIM AND CASE, AND NOTHING ELSE ───────────────────────────────────────────────────────
 * ⚠ `additional_licences[].issuing_authority` is FREE TEXT on purpose (§391.21(b)(5) says "licensing
 * authority", which admits one that is not a US state — `applicationContract.ts`), while `cdl_state`
 * is a code. Mapping "Illinois" onto "IL" would be this module deciding that two jurisdictions a
 * person wrote differently are one, on a federal requirement. So a mismatch is SHOWN — the step
 * names what is still needed, as written — and a person records the MVR with the jurisdiction as the
 * application wrote it. Trim and case are the only folds, because neither can change which agency
 * a string names.
 *
 * ⚠ **What this cannot see:** the application asks for every UNEXPIRED licence (§391.21(b)(5)), not
 * for every licence held in the preceding three years, so a licence surrendered on moving states is
 * declared nowhere. That gap is Q-AF4 in the plan's §7; nothing here pretends to close it.
 */

/** The only fold two jurisdictions get before they are compared. See the header. */
const jurisdictionKey = (s: string): string => s.trim().toLowerCase();

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Every licensing jurisdiction the applicant has declared: the licence's state, then each additional
 * licence or permit's issuing authority, as written, first spelling kept, blanks dropped.
 *
 * ⚠ Takes the two keys READ BY PATH off the draft (`cdl_state`, `additional_licences`) as `unknown`,
 * because a draft is whatever the applicant's browser last saved and is not validated until it is
 * filed. Anything that is not a string or an array of objects reads as nothing declared, which leaves
 * the step exactly where it was before AF7 rather than inventing a jurisdiction.
 */
export function declaredLicenceJurisdictions(licences: {
  cdl_state?: unknown;
  additional_licences?: unknown;
} | null): string[] {
  if (!licences) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (!nonBlank(v)) return;
    const key = jurisdictionKey(v);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v.trim());
  };
  add(licences.cdl_state);
  if (Array.isArray(licences.additional_licences)) {
    for (const l of licences.additional_licences) {
      if (l && typeof l === "object") add((l as { issuing_authority?: unknown }).issuing_authority);
    }
  }
  return out;
}

/**
 * The declared jurisdictions no recorded MVR names yet, in declaration order.
 *
 * `recorded` is one entry per MVR on file — its `detail.jurisdiction`, or null for an MVR recorded
 * without one (every MVR before AF7). ⚠ A null covers NOTHING once a jurisdiction is declared: which
 * state it came from is exactly the fact nobody wrote down, and reading it as the licence's state
 * would be the inference the header refuses. Production held no MVR rows when this shipped
 * (2026-09-25), so no existing driver's step changed colour.
 */
export function mvrJurisdictionsOutstanding(
  declared: readonly string[],
  recorded: readonly (string | null | undefined)[],
): string[] {
  const covered = new Set(recorded.filter(nonBlank).map(jurisdictionKey));
  return declared.filter((d) => !covered.has(jurisdictionKey(d)));
}
