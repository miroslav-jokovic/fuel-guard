import type { DriverApplication, EquipmentClass } from "@silvicom/shared";
import { PACKET_ROW_OF, blank, date, foldedType, yesNo } from "./packetDraw.js";
import { P1, P2, P12, P16 } from "./packetText.js";
import {
  PACKET_FIELD_LINES,
  PACKET_MARK_SIDE_LINES,
  PAGE_1_ADDRESS_COLUMNS,
  PAGE_1_ADDRESS_ROWS,
  PAGE_1_NAME_COLUMNS,
  fieldCell,
  fieldLineFor,
  fieldTableRowCount,
  type PacketFieldLine,
} from "./packetFieldGeometry.js";

/**
 * The applicant's answers, matched to the places on the carrier's paper that take them.
 *
 * ── WHAT THIS IS, AND WHAT `packetPages.ts` NEXT DOOR IS ──────────────────────────────────────
 * `packetPages.ts` DRAWS pages — it composes letterhead, headings and tables of its own onto blank
 * paper with PDFKit, which is what `renderPacket.ts` needed when the packet was being reproduced.
 * This one draws nothing. It reads a stored payload and answers *"what text goes at which measured
 * position"*, and `packetOverlay.ts` puts it on the carrier's own page. The two will not merge: one
 * owns a layout and the other owns a mapping onto somebody else's.
 *
 * ── ⚠ IT RETURNS OVERFLOW RATHER THAN DECIDING WHAT TO DO WITH IT ─────────────────────────────
 * The carrier's grids are shorter than an applicant's history can be: the licence table has ONE row,
 * accidents and convictions THREE each, references THREE. §391.21(b)(7)–(9) asks for **all** of them
 * in the period, so a form that silently drew the first three and dropped the fourth would be signed,
 * filed and materially false.
 *
 * `fieldCell` already refuses a row the form does not have, so nothing here can truncate by accident.
 * What is left over comes back as `overflow`, formatted and labelled, for the caller to place. **How
 * it gets placed is Q-PKT10 and is the owner's** — the recommendation on the plan is a continuation
 * page, which is what the carrier's own `EMPLOYMENT RECORD ( ATTACH SHEET IF MORE SPACE IS NEEDED)`
 * on page 11 asks for. Until that is answered this module makes the overflow impossible to miss
 * rather than choosing for him.
 *
 * ── EVERY VALUE GOES THROUGH `blank()` ────────────────────────────────────────────────────────
 * `renderPacket.ts`'s rule, for its reason: this reads STORED payloads.
 * `driver_applications.payload` is historical jsonb, a row filed before a field existed has none of
 * it, and a derivative that throws on an old payload is a qualification file that cannot be produced.
 */

export interface PlacedFieldValue {
  line: PacketFieldLine;
  text: string;
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
}

export interface PacketFieldFill {
  placed: PlacedFieldValue[];
  overflow: PacketFieldOverflow[];
}

export interface PacketFieldInput {
  application: DriverApplication;
  /** Server-stamped, never client-supplied (D-APP9). Page 1's `Date:`. */
  certifiedAt: string;
  /**
   * ⚠ **Each stop's OWN `application_packet_marks.signed_at`, keyed by placement id.**
   *
   * Not one "signed on" date. The walk is twenty-two separate acts and a driver who loses signal
   * finishes tomorrow — 0339's header is explicit that a half-signed packet is a state to resume
   * from. One date on thirteen lines would assert that thirteen signatures were made at a moment
   * twelve of them were not, on a document §390.32(d) asks to stay reproducible.
   */
  markedAt: Readonly<Record<string, string>>;
  /** The adopted signature, for page 22's `Driver name Print` (D-APP8). */
  signedName: string;
}

// ── questionnaire helpers, read defensively (A9/D-APP12) ──────────────────────────────────────
// A payload filed before A9 has no questionnaire at all and must still produce a document.
const answersOf = (a: DriverApplication): Record<string, unknown> =>
  (a.questionnaire_answers ?? {}) as Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));
const answer = (a: DriverApplication, id: string): string => str(answersOf(a)[id]);
const bool = (a: DriverApplication, id: string): boolean | null => {
  const v = answersOf(a)[id];
  return typeof v === "boolean" ? v : null;
};
const rowsOf = (a: DriverApplication, id: string): Array<Record<string, unknown>> => {
  const v = answersOf(a)[id];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};

/** A synthetic line for one of page 1's caption-aligned columns (see the geometry's header). */
const columnLine = (
  id: string,
  cols: readonly number[],
  col: number,
  y: number,
): PacketFieldLine => ({
  id,
  page: 1,
  x1: cols[col]!,
  x2: cols[col + 1]!,
  y,
  source: "seen",
  note: "Page 1 caption-aligned column — measured off the printed caption, not a ruled boundary.",
});

/** Fill a grid from formatted rows, and hand back whatever the carrier left no room for. */
function fillGrid(
  tableId: string,
  label: string,
  columns: readonly string[],
  page: number,
  rows: string[][],
  into: PlacedFieldValue[],
  overflow: PacketFieldOverflow[],
): void {
  const capacity = fieldTableRowCount(tableId);
  rows.slice(0, capacity).forEach((cells, r) => {
    cells.forEach((raw, c) => {
      const text = raw.trim();
      if (!text) return;
      const line = fieldCell(tableId, r, c);
      if (line) into.push({ line, text });
    });
  });
  const left = rows.slice(capacity).filter((cells) => cells.some((t) => t.trim()));
  if (left.length > 0) overflow.push({ tableId, label, columns, page, rows: left });
}

/**
 * ⚠ **Trim-checked, not truthy-checked.** A questionnaire answer of `"   "` is truthy and would be
 * placed as three spaces — invisible in the PDF, but a value the renderer believes it drew, and it
 * would keep `fittedSize` busy shrinking whitespace. `blank()` already collapses these to `""` for
 * the CONTRACT fields; `answer()` reads free-form questionnaire jsonb and does not.
 */
const push = (into: PlacedFieldValue[], id: string, text: string): void => {
  const trimmed = text.trim();
  const line = fieldLineFor(id);
  if (line && trimmed) into.push({ line, text: trimmed });
};

const addressCells = (addr: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
}): string[] => [
  blank(addr.line1) + (addr.line2 ? `, ${addr.line2}` : ""),
  blank(addr.city),
  blank(addr.state),
  blank(addr.postal_code),
];

function page1(input: PacketFieldInput, into: PlacedFieldValue[], over: PacketFieldOverflow[]): void {
  const a = input.application;
  push(into, "p01.date", date(input.certifiedAt));
  push(into, "p01.dob", date(a.date_of_birth));
  push(into, "p01.position", answer(a, "position"));
  // ⚠ The Social Security number is NOT drawn (D-HIRE6), here or on page 12 or page 15. The
  // carrier's label stays on the paper because the paper is theirs.
  push(into, "p01.cdl", `${blank(a.cdl_number)}${a.cdl_state ? ` (${a.cdl_state})` : ""}`);
  push(into, "p01.phone", blank(a.phone));
  push(into, "p01.legally_work", yesNo(bool(a, "legally_work")));
  push(into, "p01.proof_of_age", yesNo(bool(a, "proof_of_age")));
  push(into, "p01.contact_employers", yesNo(bool(a, "may_contact_employers")));
  push(into, "p01.heard_from", answer(a, "heard_from"));

  const nameParts = [a.last_name, a.first_name, a.middle_name];
  nameParts.forEach((part, i) => {
    const text = blank(part);
    if (text) into.push({ line: columnLine(`p01.name.${i}`, PAGE_1_NAME_COLUMNS, i, 509.4), text });
  });

  // ⚠ The current address takes the `Address:` rule; the rest take the three `Previous Three years
  // reisdency` rules beneath it. A fourth previous address is overflow like any other.
  const [current, ...previous] = a.addresses ?? [];
  const addressRows = [current, ...previous].filter(Boolean).map((addr) => addressCells(addr!));
  addressRows.slice(0, PAGE_1_ADDRESS_ROWS.length).forEach((cells, r) => {
    cells.forEach((raw, c) => {
      const text = raw.trim();
      if (!text) return;
      into.push({
        line: columnLine(`p01.address.${r}.${c}`, PAGE_1_ADDRESS_COLUMNS, c, PAGE_1_ADDRESS_ROWS[r]!),
        text,
      });
    });
  });
  const spare = addressRows.slice(PAGE_1_ADDRESS_ROWS.length);
  if (spare.length > 0) {
    over.push({
      tableId: "p01.residency",
      label: P1.residency,
      columns: ["Street", "City", "State", "Zip"],
      page: 1,
      rows: spare,
    });
  }
}

function page2(input: PacketFieldInput, into: PlacedFieldValue[], over: PacketFieldOverflow[]): void {
  const a = input.application;

  fillGrid(
    "p02.licences",
    // ⚠ The one grid on the carrier's page with NO printed heading — the §383.21 sentence above it
    // is a legal preamble, not a title, and reads as nonsense over a continuation block. This label
    // is OURS, and it is the only one on the sheet that is.
    "Licenses",
    P2.licenceColumns,
    2,
    [
      [blank(a.cdl_state), blank(a.cdl_number), blank(a.cdl_class), date(a.cdl_expires_at)],
      ...(a.additional_licences ?? []).map((l) => [
        blank(l.issuing_authority),
        blank(l.number),
        blank(l.kind),
        date(l.expires_at),
      ]),
    ],
    into,
    over,
  );

  // ⚠ The four class rows are PRINTED by the carrier, so column 0 is never written into and the row
  // INDEX is the class rather than the order the driver entered things. `PACKET_ROW_OF` is the fold,
  // and a second entry for a class that already has one is overflow, not a lost answer.
  const byRow = new Map<number, string[]>();
  const spare: string[][] = [];
  for (const e of a.equipment_experience ?? []) {
    const cls = (e.equipment_class ?? "other") as EquipmentClass;
    const idx = PACKET_ROW_OF[cls] ?? 3;
    const from = blank(e.from);
    const to = e.to ? String(e.to) : e.from ? "present" : "";
    const cells = [
      // ⚠ The class NAME, even though the carrier already printed it in column 0 and the loop below
      // skips writing it. It is here for the OVERFLOW rows: a second tractor-semi-trailer entry goes
      // to a continuation sheet, and a sheet whose first column is blank cannot say which of the
      // four printed classes it continues.
      P2.experienceRows[idx] ?? "OTHER",
      foldedType(cls, e.equipment_type),
      from,
      to,
      e.approx_miles == null ? "" : String(e.approx_miles),
    ];
    if (byRow.has(idx)) spare.push(cells);
    else byRow.set(idx, cells);
  }
  for (const [idx, cells] of byRow) {
    cells.forEach((raw, c) => {
      const text = raw.trim();
      // ⚠ Column 0 is the CARRIER's — the four class labels are printed on their paper. Writing our
      // own into it would put "TRACTOR - SEMI TRAILER" on top of theirs.
      if (!text || c === 0) return;
      const line = fieldCell("p02.experience", idx, c);
      if (line) into.push({ line, text });
    });
  }
  if (spare.length > 0) {
    over.push({
      tableId: "p02.experience",
      label: P2.experienceHeading,
      columns: P2.experienceColumns,
      page: 2,
      // ⚠ FIVE placed cells become FOUR on the sheet. The carrier's `DATES FROM / TO` is ONE bordered
      // column with two captions inside it, so the page takes `from` and `to` at two x positions and
      // the sheet — which has four columns because their grid has four — takes them joined. A row
      // longer than its own column list drew off the right edge of the page once.
      rows: spare.map((cells) => [
        cells[0]!,
        cells[1]!,
        [cells[2], cells[3]].filter(Boolean).join(" — "),
        cells[4]!,
      ]),
    });
  }

  fillGrid(
    "p02.accidents",
    P2.accidentsHeading,
    P2.accidentColumns,
    2,
    a.declares_no_accidents
      ? []
      : (a.accidents ?? []).map((x) => [
          date(x.occurred_on),
          blank(x.nature),
          String(x.fatalities ?? 0),
          String(x.injuries ?? 0),
          x.hazmat_spill ? "Yes" : "No",
        ]),
    into,
    over,
  );

  fillGrid(
    "p02.convictions",
    P2.violationsHeading,
    P2.violationColumns,
    2,
    a.declares_no_violations
      ? []
      : (a.violations ?? []).map((x) => [
          date(x.occurred_on),
          blank(x.offence),
          blank(x.state),
          blank(x.penalty),
        ]),
    into,
    over,
  );

  // ⚠ The packet asks A and B separately; the contract has ONE field whose own wording covers
  // "denied, revoked or suspended", so both lines take the same answer and the detail is printed
  // under A. Splitting the contract to match the form would change what the driver is ASKED, which
  // is D-PKT4's other half and counsel's.
  const denied = a.licence_ever_denied;
  push(into, denied ? "p02.denied.yes" : "p02.denied.no", "X");
  push(into, denied ? "p02.revoked.yes" : "p02.revoked.no", "X");
  if (denied) push(into, "p02.denied.explain", blank(a.licence_denial_detail));
}

function page12(input: PacketFieldInput, into: PlacedFieldValue[], over: PacketFieldOverflow[]): void {
  const a = input.application;
  fillGrid(
    "p12.identity",
    P12.heading,
    P12.identityColumns,
    12,
    [[blank(a.last_name), blank(a.first_name), (a.other_names ?? []).join(", "), date(a.date_of_birth), ""]],
    into,
    over,
  );
  fillGrid(
    "p12.employment",
    P12.heading,
    P12.logColumns,
    12,
    a.declares_no_employment
      ? []
      : (a.employers ?? []).map((e) => [
          `${date(e.started_on)} — ${e.ended_on ? date(e.ended_on) : "present"}`,
          blank(e.employer_name),
          [e.address_line1, e.city, e.state].filter(Boolean).join(", "),
          blank(e.position_held),
          blank(e.phone),
        ]),
    into,
    over,
  );
}

function page15(input: PacketFieldInput, into: PlacedFieldValue[]): void {
  const a = input.application;
  // ⚠ The DATE here is the date the driver signed THIS page — p15's own mark — not `certifiedAt`.
  // The page is a release and its date is when the release was given.
  push(into, "p15.date", date(input.markedAt["p15"] ?? input.certifiedAt));
  push(into, "p15.name", [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" "));
  push(into, "p15.dob", date(a.date_of_birth));
  // ⚠ `Sent to` is deliberately blank — the packet carries ONE copy of this page and a driver with
  // four previous employers needs it sent to four of them. Q-PKT11, open.
}

function page16(input: PacketFieldInput, into: PlacedFieldValue[], over: PacketFieldOverflow[]): void {
  const a = input.application;
  fillGrid(
    "p16.education",
    P16.heading,
    P16.educationColumns,
    16,
    rowsOf(a, "education").map((r) => [
      blank(str(r.school)),
      blank(str(r.years_completed)),
      blank(str(r.field_of_study)),
      r.graduated === true ? "Yes" : r.graduated === false ? "No" : "",
      blank(str(r.graduated_when)),
    ]),
    into,
    over,
  );

  push(into, "p16.military", yesNo(bool(a, "military_service")));
  push(into, "p16.military_when", answer(a, "military_when"));

  // ⚠ Three ruled lines and free text. Wrapped by WORD across them rather than cut at a character
  // count: the packet's own instruction is "any training you have received", and a sentence broken
  // mid-word reads as a rendering fault in a document somebody signs. What does not fit is overflow.
  const training = answer(a, "other_training").trim();
  if (training) {
    const lines = wrapToLines(training, 3, 96);
    lines.slice(0, 3).forEach((text, i) => push(into, `p16.training.${i + 1}`, text));
    if (lines.length > 3) {
      over.push({
        tableId: "p16.training",
        label: P16.training,
        columns: [""],
        page: 16,
        rows: lines.slice(3).map((l) => [l]),
      });
    }
  }

  fillGrid(
    "p16.references",
    P16.referencesIntro,
    P16.referenceColumns,
    16,
    rowsOf(a, "references").map((r) => [
      blank(str(r.full_name ?? r.name)),
      blank(str(r.years_known)),
      blank(str(r.phone ?? r.phone_number)),
    ]),
    into,
    over,
  );
}

/**
 * Break free text onto whole lines of about `perLine` characters, by word.
 *
 * ⚠ Approximate on purpose, and it is allowed to be: `packetOverlay.ts` shrinks any value that still
 * overruns its line, so a slightly long line comes out smaller rather than over the printed text.
 * What this has to get right is never splitting a word, which a character slice would.
 */
function wrapToLines(text: string, _lines: number, perLine: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > perLine && current) {
      out.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * The date beside each signature, and page 22's printed name.
 *
 * ⚠ **A stop with no mark gets NO date**, rather than today's. A half-signed packet is a real state
 * (0339), and a date on a line whose signature has not been made yet would be the document asserting
 * something that has not happened.
 */
function markSides(input: PacketFieldInput, into: PlacedFieldValue[]): void {
  for (const line of PACKET_MARK_SIDE_LINES) {
    if (line.kind === "printed_name") {
      const name = input.signedName.trim();
      if (name) into.push({ line, text: name });
      continue;
    }
    const at = input.markedAt[line.placementId];
    if (at) into.push({ line, text: date(at) });
  }
}

export function packetFieldFill(input: PacketFieldInput): PacketFieldFill {
  const placed: PlacedFieldValue[] = [];
  const overflow: PacketFieldOverflow[] = [];
  page1(input, placed, overflow);
  page2(input, placed, overflow);
  page12(input, placed, overflow);
  page15(input, placed);
  page16(input, placed, overflow);
  markSides(input, placed);
  return { placed, overflow };
}

/** Every id this module can place — for a test that wants to check the geometry is fully consumed. */
export const packetFieldIdsUsed = (): string[] => [
  ...PACKET_FIELD_LINES.map((l) => l.id),
  ...PACKET_MARK_SIDE_LINES.map((l) => l.id),
];
