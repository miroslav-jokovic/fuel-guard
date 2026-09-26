import type { HandbookSpelling } from "./handbookSpelling.js";

/**
 * Changes to the handbook's CONTENT that the owner ruled — not spelling (`handbookSpelling.ts` is
 * that), so each one says why, and none can pass as a typo fix.
 *
 * ── D-HB7 · RECEIPTS ARE NO LONGER SENT IN (owner, 2026-09-25) ────────────────────────────────
 * *"receipts sending should be removed, because we dont need them anymore"*. Every requirement to
 * send, turn in or return a receipt goes, and so does every fine for a missing one — which also ends
 * Q-HB7, the handbook's two prices for a lost fuel receipt ($25.00 and rule 6's $10.00): both lines
 * are among those removed. Supplemental rules 7–18 are renumbered 6–17 so the list the driver signs
 * has no hole in it.
 *
 * ⚠ **Kept, because none of them asks the driver to send a receipt:** `FLASIFICATION` (fuel receipts
 * are checked against logs — the carrier's own audit, from the card data), personal conveyance (a
 * receipt is one of several kinds of proof the driver may offer), and the mileage objection's "receipt
 * of said mileage determination" (receiving a document, not a receipt). The lost FUEL CARD fine stays.
 */
export interface HandbookRemoval {
  /** The block's text begins with this — a paragraph's runs, or a fuel rule's title. */
  startsWith: string;
  why: string;
}

export const HANDBOOK_REMOVALS: readonly HandbookRemoval[] = [
  { startsWith: "9. Receipts.", why: "Fuel rule 9: turn in every fuel receipt, and the $25.00 fine for a lost one." },
  { startsWith: "    *Receipts", why: "The heading of the receipts section." },
  { startsWith: "Receipts for all purchases", why: "Receipts for all purchases must be sent to the office, or be deducted from pay." },
  { startsWith: "Lost fuel receipt-$25.00 fine", why: "The fine for a lost fuel receipt." },
  { startsWith: "*Receipts", why: "Receipts in the list of paperwork the driver must include every Monday." },
  { startsWith: "6) it is important for Silvicom to have proper receipts", why: "Supplemental rule 6: missing receipts charged $10.00 each on settlement." },
];

const renumber = (from: string, to: string): HandbookSpelling => ({
  wrong: from, right: to, kind: "ruling",
  why: "Supplemental rules renumbered after rule 6 was removed (D-HB7).",
});

/** Applied by `correctHandbook` after the spelling, to what is left once the removals are made. */
export const HANDBOOK_RENUMBERING: readonly HandbookSpelling[] = [
  renumber("7) Any lumper fee", "6) Any lumper fee"),
  renumber("8) Drivers/ Independent Contractors", "7) Drivers/ Independent Contractors"),
  renumber("9) Without Silvicom approval", "8) Without Silvicom approval"),
  renumber("10) Driver/Independent Contractor shall be responsible for daily", "9) Driver/Independent Contractor shall be responsible for daily"),
  renumber("11) Silvicom shall be responsible", "10) Silvicom shall be responsible"),
  renumber("12) If Driver/Independent Contractor", "11) If Driver/Independent Contractor"),
  renumber("13) Driver/Independent Contractor shall be responsible for all non-mechanical", "12) Driver/Independent Contractor shall be responsible for all non-mechanical"),
  renumber("14) Arbitration.", "13) Arbitration."),
  renumber("15) All contracts", "14) All contracts"),
  renumber("16) Silvicom will be responsible", "15) Silvicom will be responsible"),
  renumber("17) Drivers and/or", "16) Drivers and/or"),
  renumber("18. Silvicom is not liable", "17. Silvicom is not liable"),
];
