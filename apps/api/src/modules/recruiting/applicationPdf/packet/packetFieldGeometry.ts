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
  };
}

/** How many rows of this grid the carrier's paper actually has. */
export const fieldTableRowCount = (tableId: string): number => fieldTableFor(tableId)?.rows.length ?? 0;
