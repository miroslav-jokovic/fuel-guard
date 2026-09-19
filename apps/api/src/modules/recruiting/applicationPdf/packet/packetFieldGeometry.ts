/**
 * Where the applicant's ANSWERS go on the carrier's paper (P4 re-done on the template, D-PKT1).
 *
 * ── ⚠ THE SAME KIND OF TABLE AS `packetMarkGeometry.ts`, AND FOR THE SAME REASON ──────────────
 * Hand-verified. Every entry below was established by drawing a sample value onto the carrier's own
 * page in colour, rasterising it with `pdftoppm -r 110`, and LOOKING at it —
 * `APPLICATION-PACKET-PLAN.md` §8 has the write-up of the heuristic that was tried first and does
 * not work. Nothing here was computed from a layout rule.
 *
 * ⚠ Coordinates are PDF page points, origin bottom-left, matching `packetTemplate.ts`'s output and
 * the space `pdf-lib` draws in.
 *
 * ── WHY TABLES ARE RECORDED AS TABLES AND NOT AS 100 CELLS ────────────────────────────────────
 * Page 12's employment log has fifteen rows and five columns. Writing 75 entries by hand would be
 * 75 chances to mistype a number that no reader could check, and the rows are not a guess: each
 * `rows` entry is a ruled line the carrier drew, read out of the template and asserted back against
 * it by `packetFieldGeometry.test.ts`. Deriving a cell from two measured edges is measurement;
 * inferring which edge a value belongs to is what §8 forbids, and that judgement is the one made by
 * hand above, per table, by looking at the page.
 *
 * ⚠ **`PAGE_1_NAME_COLUMNS` and `PAGE_1_ADDRESS_COLUMNS` are the exception and cannot be checked.**
 * Page 1's name and address rows are ONE long rule each, subdivided only by the printed captions
 * `Last / First / Middle` and `Street / City / State / Zip` — which are a single text run padded with
 * spaces, so there is no ruled line under any column and no run whose x a test could read. Those
 * boundaries were measured off a coordinate ruler drawn across the page and then confirmed by
 * putting values under the captions. The test says it cannot check them, rather than pretending to.
 *
 * ── WHAT IS DELIBERATELY NOT DRAWN ────────────────────────────────────────────────────────────
 * The Social Security number, in all three places the packet asks for it (page 1, page 12's `SS #`,
 * page 15's `SSN`). D-HIRE6 seals it everywhere and a rendered document a recruiter emails is the
 * last place nine digits should appear — `renderPacket.ts` made the same choice and says so. The
 * carrier's own label stays on the paper because the paper is theirs.
 */

/** How far above a rule a value's baseline sits — the carrier's own type measures 3.0pt. */
export const FIELD_BASELINE_LIFT = 3;

export interface PacketFieldLine {
  /** Stable id, `p{page}.{what}`. Never derived from an array index. */
  id: string;
  page: number;
  /** The span the value may occupy, left to right. */
  x1: number;
  x2: number;
  /** The rule the value sits on. */
  y: number;
  source: "seen" | "sibling";
  /** What the page looks like there, so a reader can check the entry without re-deriving it. */
  note: string;
  /**
   * Which grid cell this line IS, when it is one (AUD-1, 2026-09-19).
   *
   * ⚠ **Set by `fieldCell`, which is the only thing that knows** — and read rather than parsed back
   * out of `id`. The id spells `p12.employment.r0.c1` and a renderer could pick it apart with a
   * regular expression, but then two modules would own the format and the one that does not print it
   * would be the one to break silently when it changed.
   *
   * What needs it: a value too long for its column is cut on the carrier's paper, and the ROW it
   * belongs to then has to be reproduced in full on the continuation sheet — which means the renderer
   * has to be able to get from one cut cell back to its siblings. Absent on the standalone lines,
   * which have no row and are carried to the sheet on their own.
   */
  cell?: { tableId: string; row: number; col: number };
}

/**
 * One of the packet's bordered grids.
 *
 * ⚠ **`rows` is every row the CARRIER printed, and the count is the form's, not ours.** Page 2's
 * licence table has ONE row and page 12's employment log has FIFTEEN; `renderPacket.ts` drew three
 * into both, because it was drawing its own tables. Overflow is now a fact about the carrier's paper
 * — see `Q-PKT10` in the plan, which is open.
 */
export interface PacketFieldTable {
  id: string;
  page: number;
  /** Column boundaries, left to right. `n` columns is `n + 1` entries. */
  columns: readonly number[];
  /** Each data row's own bottom rule, top row first. */
  rows: readonly number[];
  source: "seen";
  note: string;
}

// ── page 1 — commercial driver information ────────────────────────────────────────────────────

/**
 * ⚠ Caption-aligned, not rule-derived, and therefore unverifiable by test — see the header. `Last`,
 * `First` and `Middle` are one padded text run over a single 450pt rule.
 */
export const PAGE_1_NAME_COLUMNS = [102.5, 214.0, 298.0, 553.2] as const;
/** The same exception, for `Street / City / State / Zip` over the address and residency rules. */
export const PAGE_1_ADDRESS_COLUMNS = [102.5, 273.0, 361.0, 418.0, 553.2] as const;

/** The address rule, and the three `Previous Three years reisdency` rules beneath it. */
export const PAGE_1_ADDRESS_ROWS = [463.7, 402.7, 372.2, 341.8] as const;

export const PACKET_FIELD_LINES: readonly PacketFieldLine[] = [
  { id: "p01.date", page: 1, x1: 102.5, x2: 205.8, y: 570.4, source: "seen",
    note: "`Date:` label left, its short rule to the right; `DOB:` is the same row's right half." },
  { id: "p01.dob", page: 1, x1: 360.5, x2: 553.2, y: 570.4, source: "seen",
    note: "Right half of the `Date:` row — a long rule running to the margin." },
  { id: "p01.position", page: 1, x1: 102.5, x2: 205.8, y: 539.9, source: "seen",
    note: "`Position:` — p01.date's layout one row down. The carrier's own question (A9/D-APP12)." },
  // ⚠ The rule at (360.5, 539.9) is `Social Security number` and is deliberately absent. D-HIRE6.
  { id: "p01.cdl", page: 1, x1: 102.5, x2: 309.0, y: 296.0, source: "seen",
    note: "`Cdl #` bold label, long rule to the right; `Phone #` is the same row's right half." },
  { id: "p01.phone", page: 1, x1: 360.5, x2: 553.2, y: 296.0, source: "seen",
    note: "Right half of the `Cdl #` row." },
  { id: "p01.legally_work", page: 1, x1: 205.7, x2: 257.4, y: 250.3, source: "seen",
    note: "`Can you legally work in USA?` — a short rule immediately after the question." },
  { id: "p01.proof_of_age", page: 1, x1: 463.7, x2: 553.2, y: 250.3, source: "sibling",
    note: "`Do you have proof of age?` — the same row's right half, same layout." },
  { id: "p01.contact_employers", page: 1, x1: 257.3, x2: 309.0, y: 219.8, source: "sibling",
    note: "`May we contact your previous employers?` — a short rule after a longer question." },
  { id: "p01.heard_from", page: 1, x1: 257.3, x2: 360.6, y: 189.4, source: "seen",
    note: "`How did you hear about this company?` — the page's last rule." },

  // ── page 2 — the two licence-history questions ──────────────────────────────────────────────
  /**
   * ⚠ **These five have no ruled line.** `Yes______` and `No_______` are printed words whose own
   * trailing underscores are the blank, exactly as a person filling the form in by hand would find
   * them — so the mark sits on the PRINTED WORD'S baseline rather than 3pt above a rule, and `y` is
   * that baseline minus `FIELD_BASELINE_LIFT` so one drawing rule serves the whole table. Confirmed
   * by drawing an X into all four and looking: it lands on the underscores.
   */
  { id: "p02.denied.yes", page: 2, x1: 76.0, x2: 95.9, y: 167.8, source: "seen",
    note: "A. `Yes______` — the X goes on the underscores that follow the printed word." },
  { id: "p02.denied.no", page: 2, x1: 122.0, x2: 148.9, y: 167.8, source: "sibling",
    note: "A. `No_______` — p02.denied.yes's layout, one word along." },
  { id: "p02.denied.explain", page: 2, x1: 257.3, x2: 553.2, y: 167.5, source: "seen",
    note: "A. `If yes, explain` — a long rule to the right of the Yes/No pair." },
  { id: "p02.revoked.yes", page: 2, x1: 76.0, x2: 95.9, y: 122.0, source: "sibling",
    note: "B. p02.denied.yes's layout — the page asks the same question shape twice." },
  { id: "p02.revoked.no", page: 2, x1: 122.0, x2: 148.9, y: 122.0, source: "sibling",
    note: "B. p02.denied.no's layout." },
  { id: "p02.revoked.explain", page: 2, x1: 257.3, x2: 553.2, y: 121.8, source: "sibling",
    note: "B. p02.denied.explain's layout." },

  // ── page 15 — past employment verification ──────────────────────────────────────────────────
  /**
   * ⚠ Six captioned cells in two rows; the first of them is the SIGNATURE and lives in
   * `packetMarkGeometry.ts` as `p15`, not here. A value and a mark on the same grid are still two
   * different things, and duplicating the signature's coordinate would be a second copy to drift.
   */
  { id: "p15.date", page: 15, x1: 205.7, x2: 257.4, y: 174.1, source: "seen",
    note: "Top row, second cell, captioned `Date` beneath." },
  { id: "p15.name", page: 15, x1: 50.9, x2: 154.2, y: 143.6, source: "seen",
    note: "Bottom row, first cell, captioned `Name of applicant` beneath." },
  { id: "p15.dob", page: 15, x1: 205.7, x2: 309.0, y: 143.6, source: "seen",
    note: "Bottom row, second cell, captioned `DOB` beneath." },
  // ⚠ `Sent to` (412.1–553.2, y 174.1) is left blank on purpose and is NOT an omission — see Q-PKT11.
  // ⚠ `SSN` (360.5–463.8, y 143.6) is left blank by D-HIRE6, like page 1's and page 12's.

  // ── page 16 — education and training ────────────────────────────────────────────────────────
  { id: "p16.military", page: 16, x1: 257.3, x2: 360.6, y: 371.5, source: "seen",
    note: "`Have you ever served in the military?` — a long rule after the question." },
  /**
   * ⚠ **Two blanks, one question, and the choice between them was made by looking.** The row reads
   * `If so, when?_________` and then carries a SEPARATE ruled line further right. The printed
   * underscores are part of the label, the way page 2's `Yes______` are; the ruled line is the
   * answer's, and it is treated like the `military` rule beside it on the same row. Both were drawn
   * into and compared.
   */
  { id: "p16.military_when", page: 16, x1: 463.7, x2: 553.2, y: 371.5, source: "seen",
    note: "The ruled line right of `If so, when?`, not the underscores printed in the label itself." },
  { id: "p16.training.1", page: 16, x1: 50.9, x2: 553.2, y: 341.0, source: "seen",
    note: "First of three full-width rules under `Please list any training you have received…`." },
  { id: "p16.training.2", page: 16, x1: 50.9, x2: 553.2, y: 325.8, source: "sibling",
    note: "Second of the same three." },
  { id: "p16.training.3", page: 16, x1: 50.9, x2: 553.2, y: 310.6, source: "sibling",
    note: "Third of the same three." },
];

/**
 * The bordered grids, each read off the carrier's own rules and then looked at.
 *
 * ⚠ Pages 12 and 16 share one column grid — 51.4 / 154.6 / 257.8 / 361.0 / 464.2 / 553.6 — because
 * the carrier drew them the same, not because anything here made them agree. They are written out
 * per table so that a re-measurement of one cannot silently move the other.
 */
export const PACKET_FIELD_TABLES: readonly PacketFieldTable[] = [
  {
    id: "p02.licences",
    page: 2,
    columns: [51.4, 154.6, 361.0, 412.6, 553.6],
    rows: [561.4],
    source: "seen",
    note: "`STATE | LICENSE NO. | TYPE | EXPIRATION DATE`. ⚠ ONE row — the carrier's form has room for a single licence (Q-PKT10).",
  },
  {
    id: "p02.experience",
    page: 2,
    // ⚠ `DATES` is one bordered column with `FROM` and `TO` printed inside it as captions; 360.0 is
    // where `TO` begins, measured off the ruler, and is not a ruled boundary.
    columns: [51.4, 206.2, 309.4, 360.0, 412.6, 553.6],
    rows: [469.2, 454.0, 438.7, 423.5],
    source: "seen",
    note: "`CLASS | TYPE | DATES FROM | TO | APPROX. MILES`. ⚠ The four class labels are PRINTED — STRAIGHT TRUCK, TRACTOR-SEMI TRAILER, TRACTOR-TWO TRAILERS, OTHER — so column 0 is the carrier's and is never written into.",
  },
  {
    id: "p02.accidents",
    page: 2,
    columns: [51.4, 154.6, 361.0, 412.6, 464.2, 553.6],
    rows: [350.4, 335.2, 319.9],
    source: "seen",
    note: "`DATES | NATURE | FATALITIES | INJURIES | CHEMICAL SPILLS`, three rows.",
  },
  {
    id: "p02.convictions",
    page: 2,
    columns: [51.4, 154.6, 309.4, 412.6, 553.6],
    rows: [243.7, 228.5, 213.2],
    source: "seen",
    note: "`DATE CONVICTED | VIOLATION | STATE OF VIOLATION | PENALTY`, three rows.",
  },
  {
    id: "p12.identity",
    page: 12,
    columns: [51.4, 154.6, 257.8, 361.0, 464.2, 553.6],
    rows: [585.6],
    source: "seen",
    note: "`Last name | First name | Aliases | DOB | SS #`, one row. ⚠ The last cell stays empty (D-HIRE6).",
  },
  {
    id: "p12.employment",
    page: 12,
    columns: [51.4, 154.6, 257.8, 361.0, 464.2, 553.6],
    rows: [524.6, 494.2, 463.7, 433.2, 402.7, 372.2, 341.8, 311.3, 280.8, 250.3, 219.8, 189.4, 158.9, 128.4, 97.9],
    source: "seen",
    note: "`Date from to | Company name | Address | Position held | Phone #` — FIFTEEN rows, which is what §391.21(b)(10)'s ten years needs and what `renderPacket.ts`'s three did not give it. ⚠ The address column is 103pt wide and a full street address shrinks to about 5.5pt in it.",
  },
  {
    id: "p16.education",
    page: 16,
    columns: [51.4, 154.6, 257.8, 361.0, 464.2, 553.6],
    rows: [539.2, 493.4, 447.7, 402.0],
    source: "seen",
    note: "`School or University | Years completed | Field of Study | Graduated? | When?`, four rows.",
  },
  {
    id: "p16.references",
    page: 16,
    columns: [51.4, 257.8, 361.0, 553.6],
    rows: [188.6, 142.9, 97.2],
    source: "seen",
    note: "`Full name | Years known | Phone number`, three rows — the page asks for exactly three.",
  },
];

/**
 * The line that sits BESIDE a signature — its date, or on page 22 the printed name.
 *
 * ── ⚠ WHY THIS EXISTS, AND WHY IT WAS NOT IN THE FIRST PASS ───────────────────────────────────
 * Found 2026-09-14, after the field coordinates for pages 1, 2, 12, 15 and 16 were already measured.
 * Thirteen of the driver's twenty-two stops carry a `Date` line beside the signature line — the
 * anchors in `packetPlacements.ts` say so in as many words, `Date | Signature`, `Signature of
 * applicant | Date`, `Driver signature: | Date:` — and page 22 carries `Driver name Print` beside
 * `Driver signatrure`. **Nothing drew any of them.** A packet signed twenty-two times with every
 * date line blank is not a filed form, and the handoff's list of "the pages that carry applicant
 * data" did not include pages 3, 4, 10, 11, 13, 17, 18, 19, 20, 22 or 31 because those are the
 * SIGNING pages and the date was assumed to be part of the mark. It is not: `packetOverlay.ts` draws
 * `signed_name` on one line and stops.
 *
 * ── WHERE THE VALUE COMES FROM, AND WHY IT IS NOT ONE DATE ────────────────────────────────────
 * ⚠ **Each stop's own `application_packet_marks.signed_at`, never a single "signed on" stamp.** The
 * walk is twenty-two separate acts and a driver who loses signal finishes tomorrow — 0339's header
 * is explicit that a half-signed packet is a real state to resume from. Printing one date on all
 * thirteen lines would be asserting that thirteen signatures were made at a moment twelve of them
 * were not, on a document whose whole purpose is to be reproducible (§390.32(d)).
 *
 * ── HOW EACH ONE WAS ESTABLISHED ──────────────────────────────────────────────────────────────
 * The §8 loop, same as everything else here. ⚠ `p10` took two passes and is the reason the loop is
 * not optional: its `Date` caption is printed ON the value's own baseline rather than beneath it, so
 * the first candidate drew the date straight through the printed word. Four of the packet's layouts
 * appear again here — caption beneath a shared rule (p04), caption inline before its own rule (p10,
 * p18), caption beneath its own rule (p13, p31), and label boxed to the left (p03, p11).
 */
export interface PacketMarkSideLine extends PacketFieldLine {
  /** The placement whose mark this line sits beside — `packetPlacements.ts`'s id. */
  placementId: string;
  /** What the carrier asks for there. */
  kind: "date" | "printed_name";
}

export const PACKET_MARK_SIDE_LINES: readonly PacketMarkSideLine[] = [
  { id: "p03.date", placementId: "p03", kind: "date", page: 3, x1: 102.5, x2: 205.8, y: 381.7,
    source: "seen", note: "`Date ____ Signature ____` — the date's own rule, left of the signature's." },
  { id: "p04.date", placementId: "p04", kind: "date", page: 4, x1: 310.8, x2: 553.2, y: 158.4,
    source: "seen", note: "One full-width rule shared with the signature; `Date` is captioned beneath it at x311, so the date takes the right portion." },
  { id: "p10.date", placementId: "p10", kind: "date", page: 10, x1: 336.0, x2: 463.8, y: 155.2,
    source: "seen", note: "⚠ `Date` is printed ON this baseline rather than beneath it, so the value starts AFTER the word. The first candidate drew straight through it." },
  { id: "p11a.date", placementId: "p11a", kind: "date", page: 11, x1: 50.9, x2: 154.2, y: 219.3,
    source: "seen", note: "`Date` captioned beneath its own rule, LEFT of the signature — the reverse of p03." },
  { id: "p11b.date", placementId: "p11b", kind: "date", page: 11, x1: 50.9, x2: 154.2, y: 127.5,
    source: "sibling", note: "p11a's layout; the page carries the pair twice." },
  { id: "p13.date", placementId: "p13", kind: "date", page: 13, x1: 360.5, x2: 463.8, y: 341.5,
    source: "seen", note: "`Date` captioned beneath its own rule, right of the signature's." },
  { id: "p17.date", placementId: "p17", kind: "date", page: 17, x1: 360.5, x2: 412.2, y: 352.5,
    source: "seen", note: "p13's layout on the top half of the split page (D-PKT12), in a shorter box." },
  { id: "p18.date", placementId: "p18", kind: "date", page: 18, x1: 463.7, x2: 553.2, y: 140.9,
    source: "seen", note: "`Driver signature: ____ Date: ____` — label boxed inline, rule to its right." },
  { id: "p19a.date", placementId: "p19a", kind: "date", page: 19, x1: 463.7, x2: 553.2, y: 538.5,
    source: "sibling", note: "p18's layout; upper of page 19's two identical driver rows." },
  { id: "p19b.date", placementId: "p19b", kind: "date", page: 19, x1: 463.7, x2: 553.2, y: 279.0,
    source: "sibling", note: "p18's layout; lower of the pair the page carries twice." },
  { id: "p20.date", placementId: "p20", kind: "date", page: 20, x1: 463.7, x2: 553.2, y: 355.7,
    source: "sibling", note: "p18's layout, under the FCRA disclosure." },
  { id: "p22.printed_name", placementId: "p22", kind: "printed_name", page: 22, x1: 50.9, x2: 309.0, y: 233.5,
    source: "seen", note: "⚠ NOT a date. `Driver name Print` left, `Driver signatrure` right — the packet asks for the name in block capitals beside the mark, which is what D-APP8 calls the printed name." },
  { id: "p31a.date", placementId: "p31a", kind: "date", page: 31, x1: 360.5, x2: 463.8, y: 554.5,
    source: "seen", note: "First of the page's three Signature/Date pairs — the driver's." },
  { id: "p31b.date", placementId: "p31b", kind: "date", page: 31, x1: 360.5, x2: 463.8, y: 234.5,
    source: "sibling", note: "Second pair — the owner-operator's. The third is the witness's and is not ours." },
];

/**
 * The lines that sit beside one placement's mark.
 *
 * ⚠ Returns an empty array for the nine stops that have none — `p05`, `p06` and `p09` take initials
 * and nothing else, and `p25`, `p26`, `p27`, `p28` and `p15` carry the signature alone (p15's date
 * is a cell of its own six-field grid and lives in `PACKET_FIELD_LINES` as `p15.date`). An empty
 * answer here is the carrier's paper, not a gap in the table.
 */
export const markSideLinesFor = (placementId: string): PacketMarkSideLine[] =>
  PACKET_MARK_SIDE_LINES.filter((l) => l.placementId === placementId);

export const fieldLineFor = (id: string): PacketFieldLine | null =>
  PACKET_FIELD_LINES.find((l) => l.id === id) ?? null;

export const fieldTableFor = (id: string): PacketFieldTable | null =>
  PACKET_FIELD_TABLES.find((t) => t.id === id) ?? null;

/**
 * One cell of a grid, as a line a value can be drawn on.
 *
 * ⚠ Returns null for a row or column the carrier's form does not have, rather than clamping to the
 * last one. A tenth accident on a three-row table is overflow and the caller has to decide what to
 * do about it (Q-PKT10); silently stacking it on row three would put two answers on one line.
 */
export function fieldCell(tableId: string, row: number, col: number): PacketFieldLine | null {
  const t = fieldTableFor(tableId);
  if (!t) return null;
  const y = t.rows[row];
  const x1 = t.columns[col];
  const x2 = t.columns[col + 1];
  if (y === undefined || x1 === undefined || x2 === undefined) return null;
  return {
    id: `${tableId}.r${row}.c${col}`,
    page: t.page,
    x1,
    x2,
    y,
    source: t.source,
    note: t.note,
    cell: { tableId, row, col },
  };
}

/** How many rows of this grid the carrier's paper actually has. */
export const fieldTableRowCount = (tableId: string): number => fieldTableFor(tableId)?.rows.length ?? 0;
