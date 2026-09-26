import { PACKET_SPELLING, type PacketSpelling } from "./packetSpelling.js";

/**
 * The packet's fines brought into line with the driver handbook (D-PKT21, owner 2026-09-25: *"the
 * handbook should win on the fines, fix the packet"*).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────────────────────
 * The driver initials packet pages 7–9 and signs page 10, then signs the handbook's fine list (h2,
 * h3) — two signed prices for one offence, found by the 2026-09-25 audit (Q-MVR6). The handbook
 * governs: it is the document the hire gate requires (D-HB5). So where the two name THE SAME OFFENCE
 * and disagree, the packet's figure (and its severity, where the handbook's differs) is changed to the
 * handbook's; nothing else on the page is touched.
 *
 * ── WHAT IS DELIBERATELY NOT CHANGED ──────────────────────────────────────────────────────────
 * An offence the handbook does not price is left as the packet has it: hours-of-service OOS
 * violations (p7), seat belt, tickets and speeding (p7 — the handbook prices "DOT violations" and
 * "general traffic violations", which are not the same list), failure to report an accident
 * IMMEDIATELY (p7 #4 — the handbook prices the accident requiring a drug test, which is p9 rule 7),
 * lateness for pick-up (p9 rule 2 — the handbook prices late DELIVERY), pin locks, notice before
 * leaving, insurance deductibles. A packet rule that names no amount (p9 rules 9, 10, 13, 15, 16) does
 * not contradict the handbook's figure and is not given one — supplying a figure is drafting.
 *
 * ⚠ **Missing fuel receipts (page 7, row 2) is not re-priced but REMOVED** — D-HB7: receipts are no
 * longer sent in, so neither document fines their absence (`PACKET_ROW_REMOVALS`).
 *
 * Applied by the same patcher as the spelling, after it, inside the carrier's own lines
 * (`packetSpellingPatch.ts`). Each entry lands exactly `times` times or the render throws.
 */
const r = (page: number, wrong: string, right: string, why: string, nth?: number[]): PacketSpelling => ({
  page, wrong, right, kind: "ruling", why, nth,
});

export const PACKET_FINES: readonly PacketSpelling[] = [
  // ── page 7 · Rules and regulations (part 1)
  r(7, "( MISSING FOR OVER 25 DAYS)", "( MISSING FOR OVER 15 DAYS)", "Handbook: `Late Logs (more than 15 days)`."),
  r(7, "$..........10.00 PER DAY", "$...........5.00 PER DAY", "Handbook: late logs `$ 5.00 per day`."),
  // Row 2, MISSING FUEL RECEIPTS, is not re-priced but removed — D-HB7, `PACKET_ROW_REMOVALS` below —
  // and rows 3–5 become 2–4.
  r(7, "3. HOURS OF SERVICE 1ST", "2. HOURS OF SERVICE 1ST", "Renumbered: row 2 (missing fuel receipts) was removed, D-HB7."),
  r(7, "4. HOURS OF SERVICE 2ND", "3. HOURS OF SERVICE 2ND", "Renumbered: row 2 (missing fuel receipts) was removed, D-HB7."),
  r(7, "5. HOURS OF SERVICE 3RD", "4. HOURS OF SERVICE 3RD", "Renumbered: row 2 (missing fuel receipts) was removed, D-HB7."),
  r(7, "$....150.00", "$.....50.00", "Handbook: failure to turn in a State Roadside Inspection or Ticket on time, `$ 50.00`."),
  r(7, "$..1,500.00", "$..100.00 & TERMINATION", "Row 2, CDL suspension not reported. Handbook: `$ 100.00 & Termination`.", [1]),
  r(7, "$..1,500.00", "$..500.00 & TERMINATION", "Row 3, allowing an unqualified or unauthorized driver. Handbook: `$ 500.00 & Termination`.", [2]),
  // ── page 9 · Rules and regulations (part 3)
  r(9, "$1000 fee and immediate termination", "$500 fee and immediate termination", "Rule 7, accident requiring a drug test not reported. Handbook: `$ 500.00 & Termination`."),
  r(9, "$150 fined and possible termination", "$500 fined and termination", "Rule 11, unauthorized riders. Handbook: `$ 500.00 & Termination` — termination is not `possible` there."),
  // ── page 10 · Rules and regulations (part 4)
  r(10, "a $150 fine per day", "a $25 fine per day", "Rule 25, driver/truck change not notified within 24 hours. Handbook: `$ 25.00 per day`."),
  r(10, "fined $100 per week", "fined $50 per week", "Rule 27, trailer/truck inspection not turned in. Handbook: `$ 50.00 per week`."),
];

/**
 * A printed row taken off a page, with the rows below it moved up to close the gap
 * (`packetSpellingPatch.ts`'s `removeRow`). Both anchors are matched against the text AFTER the
 * spelling and fines above are applied.
 */
export interface PacketRowRemoval {
  page: number;
  /** The row's text begins with this. */
  row: string;
  /** The first line that stays put — the next section's heading. */
  closeUpBefore: string;
  why: string;
}

export const PACKET_ROW_REMOVALS: readonly PacketRowRemoval[] = [
  {
    page: 7,
    row: "2. MISSING FUEL RECEIPTS",
    closeUpBefore: "TICKET PENALTIES",
    why:
      "D-HB7 (owner, 2026-09-25): \"receipts sending should be removed, because we dont need them anymore\". "
      + "The packet's fine for missing fuel receipts goes with the handbook's.",
  },
];

/** Everything that changes on the carrier's packet: spelling first (D-PKT20), then the fines (D-PKT21). */
export const PACKET_TEXT_CHANGES: readonly PacketSpelling[] = [...PACKET_SPELLING, ...PACKET_FINES];
