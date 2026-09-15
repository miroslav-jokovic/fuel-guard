/**
 * Where each of the driver's twenty-two marks goes on the carrier's paper (P5, D-PKT6).
 *
 * ── ⚠ THIS IS A HAND-VERIFIED TABLE, AND IT IS ONE ON PURPOSE ─────────────────────────────────
 * A heuristic was built first and is written up in `APPLICATION-PACKET-PLAN.md` §8 rather than here,
 * because it does not work. The model it found is real — the label's `dy` to its rule is cleanly
 * bimodal, −3 where the label sits above its own underline and +11 where it sits below the line as a
 * caption — and it still put four marks on 21pt segments, which are date boxes.
 *
 * What killed it is that **the same geometry means opposite things on different pages**:
 *
 *   · p13 `Signature of applicant` is a caption UNDER its line, so the line above is the one to sign.
 *   · p25 `Driver/Owner Signature` is a caption BOXED by two short rules, and the line to sign is the
 *     long one to its RIGHT at the same height as the lower rule.
 *
 * Both are "a label with a rule above it". A rule that separates them is a rule fitted to two
 * examples, and this is a document people sign.
 *
 * ── HOW EACH ENTRY WAS ESTABLISHED ────────────────────────────────────────────────────────────
 * By drawing every candidate rule onto the carrier's own page in colour, rasterising it with
 * `pdftoppm -r 85`, and looking at it. `source` records which entries were seen that way and which
 * were taken from a page with an identical sibling layout — `p19b` is `p19a`'s page, `p26` is `p25`'s
 * layout, and so on. **Nothing here was computed.**
 *
 * ⚠ Coordinates are PDF page points, origin bottom-left, matching `packetTemplate.ts`'s output and
 * the space `pdf-lib` draws in. `packetMarkGeometry.test.ts` asserts every line below really exists
 * in the template at that position, so a re-export that moves the paper fails the build rather than
 * silently moving somebody's signature.
 */

export interface PacketMarkLine {
  /** The placement id from `packetPlacements.ts`. */
  id: string;
  page: number;
  /** The ruled line, left to right. */
  x1: number;
  x2: number;
  /** The rule's own y. A mark is drawn a little above it — see `MARK_BASELINE_LIFT`. */
  y: number;
  source: "seen" | "sibling";
  /** What the page looks like, so a reader can check the entry without re-deriving it. */
  note: string;
}

/**
 * How far above the rule a mark's baseline sits.
 *
 * ⚠ 3pt, which is what the carrier's own type does: on every page where a label is printed over its
 * rule, the text baseline measures 3.0pt above it. Matching the paper's own offset is what makes a
 * drawn signature sit like the printed words around it rather than floating or cutting the line.
 */
export const MARK_BASELINE_LIFT = 3;

export const PACKET_MARK_LINES: readonly PacketMarkLine[] = [
  { id: "p03", page: 3, x1: 309, x2: 553, y: 381.7, source: "seen",
    note: "`Date ____  Signature ____` — label left, its line to the right." },
  // ⚠ The signature and the date SHARE one full-width rule here; the captions below it are at x53 and
  // x311, so the signature takes the left portion and stops short of the date's.
  { id: "p04", page: 4, x1: 51, x2: 305, y: 158.4, source: "seen",
    note: "One full-width rule with `Applicant's Signature` and `Date` captioned beneath it." },
  { id: "p05", page: 5, x1: 412, x2: 553, y: 158.4, source: "seen",
    note: "`Initials` captioned under its line, bottom right." },
  { id: "p06", page: 6, x1: 464, x2: 553, y: 127.4, source: "sibling",
    note: "p05's layout: `Initials` captioned under its line, in a narrower box." },
  { id: "p09", page: 9, x1: 464, x2: 553, y: 108.5, source: "sibling",
    note: "p05's layout: `Initials` captioned under its line, in a narrower box." },
  // ⚠ **Stops at 305, not at the rule's own end (463.8), and that is a CORRECTION made 2026-09-14.**
  // The rule is shared with the page's `Date`, whose caption is printed inline at x310.8 — so a name
  // long enough to need the full span would have been drawn straight through the printed word and
  // through the date beside it. p04 got this right from the start ("stops short of the date's") and
  // p10 did not; nothing noticed until `packetFieldGeometry.test.ts` asserted that no line beside a
  // mark may overlap the mark's own span. Nothing filed changes: production holds zero packet marks
  // and the overlay has no production importer.
  { id: "p10", page: 10, x1: 102, x2: 305, y: 155.2, source: "seen",
    note: "`Signature` boxed by two short rules; the long line runs to its right and is SHARED with `Date`, whose caption is inline at x310.8." },
  { id: "p11a", page: 11, x1: 257, x2: 553, y: 219.3, source: "seen",
    note: "Upper of the page's two `Applicant signature` lines, captioned beneath." },
  { id: "p11b", page: 11, x1: 257, x2: 553, y: 127.5, source: "seen",
    note: "Lower of the same pair — the certification that the application is true." },
  { id: "p13", page: 13, x1: 51, x2: 257, y: 341.5, source: "seen",
    note: "`Signature of applicant` captioned under its line; `Date` is a separate group right." },
  { id: "p15", page: 15, x1: 51, x2: 154, y: 173.5, source: "seen",
    note: "Six-field grid; the signature is the first cell, captioned beneath." },
  { id: "p17", page: 17, x1: 51, x2: 206, y: 352.5, source: "seen",
    note: "Top half of the split page (D-PKT12); `INTERVIEW NOTES` begins below it." },
  { id: "p18", page: 18, x1: 154, x2: 412, y: 140.9, source: "seen",
    note: "`Driver signature: ____ Date: ____` — label boxed, line to its right." },
  { id: "p19a", page: 19, x1: 154, x2: 412, y: 538.5, source: "sibling",
    note: "p18's layout; upper of page 19's two identical driver lines." },
  { id: "p19b", page: 19, x1: 154, x2: 412, y: 279.0, source: "sibling",
    note: "p18's layout; lower of the pair the page carries twice." },
  { id: "p20", page: 20, x1: 154, x2: 412, y: 355.7, source: "seen",
    note: "p18's layout, under the FCRA disclosure." },
  { id: "p22", page: 22, x1: 360, x2: 553, y: 233.5, source: "seen",
    note: "`Driver name Print` left, `Driver signatrure` right, both captioned beneath." },
  { id: "p25", page: 25, x1: 257, x2: 553, y: 403.0, source: "seen",
    note: "`Driver/Owner Signature` boxed; the long line runs to its right." },
  { id: "p26", page: 26, x1: 257, x2: 553, y: 320.9, source: "sibling",
    note: "p25's layout: the caption is boxed and the long line runs to its right." },
  { id: "p27", page: 27, x1: 51, x2: 464, y: 176.6, source: "seen",
    note: "One rule on the page, `Signature` captioned beneath it." },
  { id: "p28", page: 28, x1: 51, x2: 464, y: 289.4, source: "sibling",
    note: "p27's layout: one rule on the page with `Signature` captioned beneath it." },
  { id: "p31a", page: 31, x1: 51, x2: 309, y: 554.5, source: "seen",
    note: "First of the page's three Signature/Date pairs — the driver's." },
  { id: "p31b", page: 31, x1: 51, x2: 309, y: 234.5, source: "seen",
    note: "Second pair — the owner-operator's. The third is the witness's and is not ours." },
];

/** The line a mark goes on, or null for an id this table does not carry. */
export const markLineFor = (id: string): PacketMarkLine | null =>
  PACKET_MARK_LINES.find((l) => l.id === id) ?? null;
