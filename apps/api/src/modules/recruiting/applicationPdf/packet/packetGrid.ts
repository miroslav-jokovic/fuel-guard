import type { DriverApplication } from "@silvicom/shared";
import { fieldCell, fieldTableRowCount, type PacketFieldLine } from "./packetFieldGeometry.js";

/**
 * The carrier's bordered grids: what fits in one, what is left over, and what goes on the rows the
 * applicant did not use.
 *
 * ── WHY THIS IS NOT PART OF `packetFieldValues.ts` ────────────────────────────────────────────
 * That module answers *"which of the applicant's answers goes where"* — twenty-odd page functions
 * reading a stored payload. This one answers *"how is a grid on their paper filled"*, and knows
 * nothing about applicants. The seam is real rather than a line-budget dodge: `fillGrid` is called
 * by eight of those page functions and has now grown a rule (`filler`) that is about the PAPER, not
 * about the answers, and reviewing that rule means reading it next to `fieldCell`'s refusal rather
 * than next to page 12's column order.
 */

export interface PlacedFieldValue {
  line: PacketFieldLine;
  text: string;
  /**
   * The carrier's own word for what this value answers — a column heading, or the printed question
   * beside a standalone rule (AUD-1, 2026-09-19).
   *
   * ⚠ **Used only when the value has to be CUT**, and then it is the only thing that lets the
   * continuation sheet say what the answer underneath it belongs to. Optional because most values
   * never need naming: they fit, and the carrier's page already has the question printed next to
   * them. ⚠ It must be the carrier's wording rather than ours, for Q-PKT10's reason — the sheet is
   * part of the application the driver certifies, and a sheet that renamed their question would be a
   * different form appended to theirs.
   *
   * ⚠ Set on STANDALONE rules only. A grid cell is named by `grid` below instead, because a cut cell
   * needs its whole row reassembled and a lone column heading cannot do that.
   */
  label?: string;
  /**
   * The grid this value is a cell of, as the continuation sheet would need to describe it (AUD-1).
   *
   * ⚠ **Carried on every cell rather than looked up afterwards, and that is not redundancy.** By the
   * time the renderer discovers a value will not fit, it holds a `PacketFieldLine` and nothing else;
   * the grid's heading and column names were arguments to `fillGrid` and are out of reach. The ONLY
   * other place they survive is an overflow block, and a grid whose rows all fitted has none — which
   * is exactly the case a too-wide cell creates.
   */
  grid?: { label: string; columns: readonly string[] };
}

/**
 * A grid's leftovers, in that grid's own column order.
 *
 * ⚠ **Carries the carrier's OWN heading and column names, not ours** (Q-PKT10, answered 2026-09-14).
 * The continuation sheet is part of the application the driver certifies, so a reader comparing it
 * against the page it continues has to see the same words: §391.21(a) makes the application "a form
 * furnished by the motor carrier", and a sheet that renamed `DATE CONVICTED` to "Date" would be a
 * different form appended to theirs.
 */
export interface PacketFieldOverflow {
  tableId: string;
  /** The carrier's own heading for the grid, verbatim. */
  label: string;
  /** The carrier's own column headings, verbatim and in their order. */
  columns: readonly string[];
  /** The carrier's own page number, so the sheet can say which page it continues. */
  page: number;
  rows: string[][];
  /**
   * How many of `rows`, counting from the END, are rows that ALSO appear on the carrier's page — cut
   * short there because a value was too long for its column, and reproduced here in full (AUD-1).
   *
   * ⚠ **The distinction has to reach the notice printed under the grid**, because the two cases are
   * different sentences to the person reading page 2. A row the carrier printed no space for is
   * *missing from* this page; a row whose text was cut is *shown in full on* the sheet. Telling a
   * reader "1 more entry" about a row that is visibly right in front of them is how an attachment
   * becomes the place an answer was hidden.
   *
   * Counted from the end because `fillGrid` appends the capacity leftovers first and the renderer
   * appends the cut rows after them; absent means none, which is the ordinary case.
   */
  continued?: number;
}

export interface PacketFieldFill {
  placed: PlacedFieldValue[];
  overflow: PacketFieldOverflow[];
}

/**
 * What a fill needs to know about one application.
 *
 * ⚠ Here rather than beside `packetFieldFill`, because there are now TWO modules that fill from it —
 * `packetFieldValues.ts` for the pages that ask questions and `packetSigningFields.ts` for the pages
 * the driver signs (AUD-17) — and the one that owns the orchestrator must not also be the one the
 * other has to import a type from.
 */
export interface PacketFieldInput {
  application: DriverApplication;
  /** Server-stamped, never client-supplied (D-APP9). Page 1's `Date:`. */
  certifiedAt: string;
  /**
   * ⚠ **Each stop's OWN `application_packet_marks.signed_at`, keyed by placement id.**
   *
   * Not one "signed on" date. The walk is twenty-two separate acts and a driver who loses signal
   * finishes tomorrow — 0339's header is explicit that a half-signed packet is a state to resume
   * from. One date on sixteen lines would assert that sixteen signatures were made at a moment
   * fifteen of them were not, on a document §390.32(d) asks to stay reproducible.
   */
  markedAt: Readonly<Record<string, string>>;
  /**
   * The adopted signature, as the driver typed it (D-APP8).
   *
   * ⚠ **It is NOT what any `Print name` line prints** — see `fullName` in `packetDraw.ts` for why,
   * and AUD-18 for the day the two disagreed on one document. Kept on the input because the mark
   * itself is drawn from it by `packetOverlay.ts`, which is a different question from what the
   * carrier's name lines say.
   */
  signedName: string;
}

/**
 * Put one value on one measured line, or drop it.
 *
 * ⚠ **Trim-checked, not truthy-checked.** A questionnaire answer of `"   "` is truthy and would be
 * placed as three spaces — invisible in the PDF, but a value the renderer believes it drew, and it
 * would keep the fitter busy shrinking whitespace. `blank()` already collapses these to `""` for the
 * CONTRACT fields; free-form questionnaire jsonb is not read through it.
 *
 * ⚠ **It takes the LINE, not an id**, and that changed with AUD-17. There are two geometry tables
 * now — the answers' and the signing pages' — so a resolver baked in here would have to know both,
 * and would silently drop any id it happened not to carry. Each caller resolves against the table it
 * is filling, which is the one thing it definitely knows.
 */
export function placeValue(
  into: PlacedFieldValue[],
  line: PacketFieldLine | null,
  text: string,
  label?: string,
): void {
  const trimmed = text.trim();
  if (line && trimmed) into.push({ line, text: trimmed, label });
}

/**
 * ⚠ **D-PKT14 — the filler is OPT-IN PER GRID, and that is a legal decision rather than a style one.**
 *
 * The owner's ruling, 2026-09-14: *"leave them optional but in print we should add something like
 * N/A or something that will fill there so we dont have empty lines printed."* It names page 16's
 * education and reference lines, and this parameter exists so that it reaches those two grids and
 * stops there.
 *
 * **The reason it must not default on** is that an empty row does not mean the same thing on every
 * one of the carrier's grids:
 *
 * - On page 16 the applicant is invited to leave the lines blank — `questionnaireContract.ts` gives
 *   education and references no `required` flag, deliberately, and Marija left both empty on the
 *   first application ever filed. `N/A` there restates a choice the form already permits.
 * - On page 12's employment log, page 2's licence table and the accident and conviction grids, the
 *   rows answer §391.21(b)(7)–(10). Those questions have their own declarations — an applicant ticks
 *   `declares_no_accidents` — and writing `N/A` across a regulated grid would put a SECOND assertion
 *   on the paper next to the one they actually made. Two sources of truth for one declaration, on a
 *   document somebody signs.
 *
 * ⚠ **A stronger argument for filling exists and it is deliberately NOT acted on here.** An empty
 * ruled line on a signed form is a place a fourth reference can be written in afterwards, and filling
 * every grid would close that. It would also extend the owner's ruling from two cosmetic lists onto
 * the regulated grids on his behalf, which is his call and counsel's, not this module's. Recorded in
 * `APPLICATION-PACKET-PLAN.md` §8 as an open question rather than taken quietly.
 */
export type GridFiller = string | undefined;

/**
 * Fill a grid from formatted rows, and hand back whatever the carrier left no room for.
 *
 * `rows` are the applicant's, already formatted, in the grid's own column order. Anything past the
 * number of rows the carrier PRINTED comes back as overflow — `fieldCell` refuses a row the form
 * does not have, so nothing here can truncate by accident.
 */
export function fillGrid(
  tableId: string,
  label: string,
  columns: readonly string[],
  page: number,
  rows: string[][],
  into: PlacedFieldValue[],
  overflow: PacketFieldOverflow[],
  filler?: GridFiller,
): void {
  const capacity = fieldTableRowCount(tableId);
  rows.slice(0, capacity).forEach((cells, r) => {
    cells.forEach((raw, c) => {
      const text = raw.trim();
      if (!text) return;
      const line = fieldCell(tableId, r, c);
      // ⚠ The heading is carried on every cell rather than looked up later: by the time a renderer
      // discovers the value does not fit, it has a `PacketFieldLine` and no way back to the column
      // list that named it. `columns` is the carrier's own wording, which is what the sheet needs.
      if (line) into.push({ line, text, grid: { label, columns } });
    });
  });

  // ⚠ **Decided PER ROW, not from a starting index — and both of the obvious index rules are
  // wrong.** Found by mutation while writing the tests for this, against a payload whose first
  // reference row is blank and whose second carries a name, which is exactly what the web form
  // produces when an applicant types into the second row of a list it opened with one empty one:
  //
  //   from `rows.length`                    → fills row 2 only, and row 0 PRINTS BLANK
  //   from the count of rows carrying text  → fills rows 1 and 2, and row 1 OVERWRITES the name
  //
  // A row is a candidate because the applicant left it empty, which is a fact about that row. A row
  // they part-filled — a referee's name with no phone yet — is a row they USED, and `N/A` in the
  // cell beside the name would contradict it.
  //
  // ⚠ The `capacity` bound is belt-and-braces and no test can fail on it: mutating it to `r <=
  // capacity` passes, because `fieldCell` refuses a row the carrier's form does not have and the
  // inner loop then writes nothing. Said here rather than pinned by a contrived assertion — the
  // guard that actually holds is the geometry's, pinned by "refuses a row the carrier's form does
  // not have" and "refuses a column past the last boundary, and an unknown grid".
  if (filler) {
    for (let r = 0; r < capacity; r += 1) {
      if (rows[r]?.some((t) => t.trim())) continue;
      // Walk the columns until the geometry refuses one, rather than counting either array to hand.
      // The geometry holds column EDGES, so five cells are six numbers and any cell count derived
      // from it is an off-by-one waiting to happen; `columns` here is the caller's heading list,
      // which is the carrier's words and not a measurement. `fieldCell` reads the measured edges and
      // already refuses a column the form does not have — so asking it is the only count that cannot
      // drift from the paper.
      for (let c = 0; ; c += 1) {
        const line = fieldCell(tableId, r, c);
        if (!line) break;
        into.push({ line, text: filler });
      }
    }
  }

  const left = rows.slice(capacity).filter((cells) => cells.some((t) => t.trim()));
  if (left.length > 0) overflow.push({ tableId, label, columns, page, rows: left });
}
