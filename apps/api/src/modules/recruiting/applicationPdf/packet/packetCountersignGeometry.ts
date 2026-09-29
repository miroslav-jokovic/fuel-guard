/**
 * Where the carrier's countersignature goes on its own packet (Q-HB1; HANDBOOK-SIGNING-PLAN.md §6.1,
 * D-HB9).
 *
 * ── WHY A TABLE OF ITS OWN ────────────────────────────────────────────────────────────────────
 * `packetMarkGeometry.ts` is the driver's lines and nothing else, and `packetOverlay.ts` draws it at
 * the driver's filing. These four are drawn LATER, by a different person, onto bytes already filed
 * (`packetCountersignStamp.ts`), so they are a different question about the same paper, the split
 * `packetSigningGeometry.ts` already makes for the signer's restated identity.
 *
 * ── ⚠ MEASURED, THEN LOOKED AT (2026-09-29) ─────────────────────────────────────────────────
 * The handoff said these lines were already measured, and they were not: `packetSigningGeometry.ts`
 * only listed them as what stays blank. Every number below comes from the template's own rules
 * (`readPacketTemplate`), was drawn in magenta with cyan span ticks, rasterised with `pdftoppm -r 110`
 * and looked at. `packetCountersignGeometry.test.ts` asserts each rule is on the page where this says.
 *
 * ⚠ **`p22c` is not laid out like the other three, and only looking showed it.** Its `Date` rule is
 * NOT level with the signature rule: it sits beside the printed `Date` caption, 16pt lower (y141.2 vs
 * y157.4). A date drawn level with the signature floated in blank paper. And the carrier's caption
 * `Company representative's signature` is printed UNDER the p22c rule, so the applied-by line goes
 * below that caption rather than straight under the rule, where it would print over it.
 *
 * ⚠ Coordinates are PDF page points, origin bottom-left, as in `packetMarkGeometry.ts`.
 */

export interface PacketCountersignLine {
  /** The carrier placement id in `packetPlacements.ts`. */
  id: string;
  page: number;
  /** The signature rule, left to right, and its own y. */
  x1: number;
  x2: number;
  y: number;
  /** The carrier's `Date` rule beside it, where the page has one. */
  date: { x1: number; x2: number; y: number } | null;
  /**
   * Where the applied-by caption's baseline starts, and how far it may run.
   *
   * ⚠ Its own right edge, not the rule's. On `p19ac` and `p22c` the rule is short (206pt, 258pt) and
   * the first render cut the caption with an ellipsis, losing the date and who applied the mark, which
   * is the whole point of it. The paper under both is blank to the right margin (looked at, 110 dpi),
   * so the caption runs to 553.2, the carrier's own right rule edge on these pages.
   */
  caption: { x: number; y: number; x2: number };
  note: string;
}

export const PACKET_COUNTERSIGN_LINES: readonly PacketCountersignLine[] = [
  { id: "p18c", page: 18, x1: 205.7, x2: 553.2, y: 110.3, date: null, caption: { x: 207.7, y: 101.5, x2: 553.2 },
    note: "`Silvicom Inc Representative:` boxed left, one long rule; the carrier's footer sits below it." },
  { id: "p19ac", page: 19, x1: 205.7, x2: 412.2, y: 492.7, date: { x1: 463.7, x2: 553.2, y: 492.7 },
    caption: { x: 207.7, y: 483.9, x2: 553.2 },
    note: "Upper of page 19's two carrier lines, with its own `Date:` rule level with it." },
  { id: "p19bc", page: 19, x1: 205.7, x2: 553.2, y: 157.4, date: null, caption: { x: 207.7, y: 148.6, x2: 553.2 },
    note: "Lower carrier line on page 19; no date rule." },
  { id: "p22c", page: 22, x1: 50.9, x2: 309.0, y: 157.4, date: { x1: 412.1, x2: 553.2, y: 141.2 },
    caption: { x: 52.8, y: 134.0, x2: 553.2 },
    note: "Rule above its printed caption; the `Date` rule is 16pt LOWER, beside the `Date` caption." },
];

/** The line a carrier placement is drawn on, or null for an id this table does not carry. */
export const countersignLineFor = (id: string): PacketCountersignLine | null =>
  PACKET_COUNTERSIGN_LINES.find((l) => l.id === id) ?? null;
