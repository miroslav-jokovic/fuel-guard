import { jurisdictionName, jurisdictionOptions, toJurisdictionCode } from "./jurisdictions.js";

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
 * ── HOW TWO JURISDICTIONS ARE COMPARED (Q-AF5, ruled by the owner 2026-09-25) ────────────────
 * Through `toJurisdictionCode`, the ONE catalogue every state field in the application already
 * stores through (`jurisdictions.ts`, D-AX5). So `IL`, `il`, `Illinois` and ` illinois ` are one
 * jurisdiction, as they are everywhere else in the product. That table is published fact (USPS
 * codes and the provinces' own abbreviations), not a guess, and it is the same table the applicant's
 * licence-state picker wrote the value with.
 *
 * ⚠ **Nothing past the catalogue.** `additional_licences[].issuing_authority` is FREE TEXT on
 * purpose (§391.21(b)(5) says "licensing authority", which admits one that is not a state —
 * `applicationContract.ts`), so a value the catalogue cannot place — "Indiana BMV", a Mexican
 * federal licence — is compared after trim and case only. Reading "Indiana BMV" as Indiana would be
 * this module deciding what an agency's name means on a federal requirement. The office's form
 * offers every declared jurisdiction as written (`mvrJurisdictionOptions`), so such a value is
 * picked, not retyped.
 *
 * ⚠ **What this could not see until 2026-09-25, and what closed it (Q-AF4).** §391.21(b)(5) asks the
 * application for every UNEXPIRED licence, which is narrower than "held or holds" in the preceding
 * three years: a licence surrendered on moving states was declared nowhere. The owner ruled the
 * application asks for both, so its licence copy now reads `MVR_LOOKBACK_YEARS` and invites past
 * licences into `additional_licences`, which never refused an expiry in the past. A licence that
 * expired long before the window is still owed an MVR if the applicant lists it: the expiry date is
 * not the date it stopped being held, so it cannot be used to excuse one.
 */

/**
 * §391.23(a)(1)'s look-back: every state that licensed the driver "during the preceding 3 years".
 *
 * ⚠ Its own constant rather than `EMPLOYMENT_WINDOW_YEARS`, which is also 3 today but is a different
 * paragraph's window (§391.21(b)(10)); the application's licence copy reads this one, so the words
 * the applicant is asked and the rule their answer is checked against cannot drift apart.
 */
export const MVR_LOOKBACK_YEARS = 3;

/**
 * The fold two jurisdictions get before they are compared. See the header.
 *
 * ⚠ A catalogue code comes back upper-case and anything else lower-case, so the two cannot collide:
 * any string the catalogue can place is always turned into its code first.
 */
const jurisdictionKey = (s: string): string => toJurisdictionCode(s) ?? s.trim().toLowerCase();

const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Every licensing jurisdiction the applicant has declared: the licence's state, then each additional
 * licence or permit's issuing authority. One entry per jurisdiction (`IL` and `Illinois` are one),
 * a catalogue state as its code and anything else as first written, blanks dropped.
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
    out.push(toJurisdictionCode(v) ?? v.trim());
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

/**
 * What the office's State picker offers when recording an MVR: the jurisdictions still owed first,
 * then the whole catalogue (Q-AF5).
 *
 * ⚠ The owed ones lead because they are the answer nine times in ten, and they are the ONLY way to
 * offer an authority the catalogue cannot place ("Indiana BMV") — a picker limited to the catalogue
 * would leave that licence permanently uncoverable. A catalogue state is offered by its code, the
 * value every other state field stores; anything else by the text the applicant declared, which is
 * exactly what `mvrJurisdictionsOutstanding` will match it against.
 */
export function mvrJurisdictionOptions(
  outstanding: readonly string[],
): Array<{ value: string; label: string }> {
  const owed = outstanding.map((o) => {
    const code = toJurisdictionCode(o);
    return code
      ? { value: code, label: `${jurisdictionName(code)} (${code}) — still needed` }
      : { value: o.trim(), label: `${o.trim()} — still needed` };
  });
  const taken = new Set(owed.map((o) => o.value));
  return [...owed, ...jurisdictionOptions().filter((j) => !taken.has(j.value))];
}
