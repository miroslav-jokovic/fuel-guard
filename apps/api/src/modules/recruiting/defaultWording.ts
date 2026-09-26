import {
  AUTHORIZATION_PURPOSES,
  DISCLOSURES,
  ESIGN_CONSENT,
  type CarrierWording,
  type DisclosureDocument,
} from "@silvicom/shared";
import { clearinghouseConsent } from "./clearinghouseConsent.js";
import { packetWording } from "./packetWording.js";
import { pspDisclosure } from "./pspDisclosure.js";

/**
 * The wording this product ships — researched, sourced, and non-draft (2026-09-14, D-WORD1).
 *
 * ── WHAT CHANGED, AND WHY THE SETTINGS PAGE WENT WITH IT ──────────────────────────────────────
 * Until today every instrument was `v0-draft` placeholder text an engineer wrote, and the way out
 * was `/settings/application-wording`: the carrier reads six documents and presses Publish six
 * times. The owner's ruling on 2026-09-14 was that this is the wrong shape — **the product should
 * ship words that are already right rather than ask its customer to approve words that are not.**
 * So the catalogue below IS the wording, the versions are not `v0`, every gate opens on deploy, and
 * the page that existed to get past them is gone.
 *
 * ── WHERE EVERY WORD COMES FROM, AND WHY NONE OF IT IS MINE ───────────────────────────────────
 * The research behind this is in `WORDING-REVIEW-2026-09-13.md`. Its finding was not that better
 * text needed writing — it was that **four of the six already had an authoritative source and
 * nobody had gone and got it.**
 *
 * | Instrument           | Source                                                    | Discretion |
 * | -------------------- | --------------------------------------------------------- | ---------- |
 * | `psp`                | FMCSA's published form                                     | **none** — mandatory, in whole, exactly as provided |
 * | `clearinghouse`      | FMCSA's published sample + the scope §382.701(b) forces    | the scope only, and it is forced |
 * | `esign_consent`      | 15 U.S.C. 7001(c)(1), six clauses read off the statute      | none |
 * | `fcra_disclosure`    | the carrier's packet, page 19 — their counsel              | none |
 * | `previous_employer`  | the carrier's packet, page 14 — their counsel              | none |
 * | `drug_alcohol`       | the carrier's packet, page 21 — their counsel              | none |
 * | `mvr`                | the carrier's packet, page 19 — their counsel (D-MVR1)     | none |
 *
 * ⚠ **Nothing here was drafted by an engineer, and that is the point of the whole exercise.** Two
 * candidates were considered and rejected: writing model FCRA and §40.25 text ourselves (worse than
 * the carrier's counsel, and precisely what the owner said not to do), and adopting FMCSA's
 * Safety Performance History Records Request as the previous-employer release (it is a per-employer
 * fill-in form with blanks, not a single electronic release, so it does not fit the instrument).
 *
 * ── WHY THE VERSIONS SAY WHERE THEY CAME FROM ─────────────────────────────────────────────────
 * `driver_authorizations.disclosure_version` is stored on every signature and is what an auditor
 * reads years later to ask "what did this person actually sign?". `v1` answers that only if you
 * also hold this repository at the right commit. `fmcsa-2016-02-11` answers it on its own — it
 * names the federal form and its revision date. So the shipped versions are provenance strings
 * rather than counters.
 *
 * ⚠ They must also survive `isDraftDisclosure()`, which refuses anything starting `v0` or ending
 * `-draft`. None of these do, by construction rather than by a rule somebody could relax; the test
 * asserts it for every one.
 *
 * ⚠ And they are a SEPARATE NAMESPACE from `org_disclosures`, whose rows are still numbered `v1`,
 * `v2`, … by `publishWording`. A carrier that publishes its own text overlays these, and the two
 * can never collide or be mistaken for one another in an audit.
 */

/** The federal form's own footer date. Re-download before changing it. */
export const PSP_VERSION = "fmcsa-2016-02-11";
/** FMCSA's sample carries no revision date, so this is the day it was downloaded and pinned. */
export const CLEARINGHOUSE_VERSION = "fmcsa-sample-2026-09-13";
/**
 * The carrier's packet text as served: `APPLICATION.xlsx` (mtime 2026-08-21) with `PACKET_SPELLING`
 * applied. ⚠ Bumped from `packet-2026-08-21` on 2026-09-25 (D-PKT20) because the corrections changed
 * served words (`with` → `wish`, `they` → `the` on page 15): a version names ONE text, and rows signed
 * under the old id keep their own stored `disclosure_text`. Change it again whenever that register
 * changes an instrument page (15, 19, 20, 22).
 */
export const PACKET_VERSION = "packet-2026-09-25";
/** Read off the statute (Cornell LII) on the date in `authorizationContract.ts`'s header. */
export const ESIGN_VERSION = "15usc7001c-2026-08-21";

/**
 * The seven documents, with the carrier's name filled into the forms that leave a blank for it.
 *
 * ⚠ The name is a parameter and not a constant because two of these instruments authorise a NAMED
 * company to do something: FMCSA's PSP form and its Clearinghouse sample both read "I authorize
 * ___". An instrument naming the wrong carrier, or naming none, authorises nobody.
 */
export function defaultWording(carrierName: string): CarrierWording {
  const psp = pspDisclosure(carrierName);
  const clearinghouse = clearinghouseConsent(carrierName);

  /** Everything the catalogue already knows — the purpose and the citation — kept as it is. */
  const from = (
    purpose: (typeof AUTHORIZATION_PURPOSES)[number],
    version: string,
    doc: { title: string; body: string; intent: string },
  ): DisclosureDocument => ({ ...DISCLOSURES[purpose], version, ...doc });

  const disclosures = { ...DISCLOSURES } as Record<(typeof AUTHORIZATION_PURPOSES)[number], DisclosureDocument>;

  // The four the carrier's own lawyers wrote — `mvr` since 2026-09-25 (D-MVR1), page 19's
  // `AUTHORIZATION FOR DRIVING RECORD CHECK`, moved out of the application. `packetWording` returns null for anything the packet
  // has no page for, and the fallback is the placeholder — which is `v0-draft`, which refuses.
  // ⚠ That is the one branch here that can still leave a gate shut, and it is the safe direction.
  for (const purpose of ["fcra_disclosure", "previous_employer", "drug_alcohol", "mvr"] as const) {
    const packet = packetWording(purpose);
    if (packet) disclosures[purpose] = from(purpose, PACKET_VERSION, packet);
  }

  disclosures.psp = from("psp", PSP_VERSION, psp);
  disclosures.clearinghouse = from("clearinghouse", CLEARINGHOUSE_VERSION, clearinghouse);

  return {
    disclosures,
    // The clauses are already the statute's own six, read off it rather than summarised — all that
    // changes is that the version stops calling them a draft.
    esignConsent: { ...ESIGN_CONSENT, version: ESIGN_VERSION },
  };
}
