import { questionnaireAnswersOf, type DriverApplication } from "@silvicom/shared";
import { blank, yesNo } from "./packetDraw.js";
import { P16 } from "./packetText.js";
import {
  fillGrid,
  placeValue,
  type PacketFieldInput,
  type PacketFieldOverflow,
  type PlacedFieldValue,
} from "./packetGrid.js";
import { fieldLineFor } from "./packetFieldGeometry.js";

/**
 * The carrier's own questions on their paper — the questionnaire readers, and page 16, which is
 * nothing but questionnaire answers (A9/D-APP12, D-PKT14).
 *
 * ⚠ **Split out of `packetFieldValues.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning. The seam is where an answer comes from: page 16 reads `questionnaire_answers`
 * and nothing §391.21 numbers, so it moved with the helpers that read them, unchanged and with its
 * comments. `push` came too because every page uses it and this module is the one the rest import
 * from; `packetFieldValues.ts` still owns `packetFieldFill` and calls `page16` in the same order.
 */

// ── questionnaire helpers, read defensively (A9/D-APP12) ──────────────────────────────────────
// A payload filed before A9 has no questionnaire at all and must still produce a document.
// ⚠ Draft OR filed (`questionnaireAnswersOf`): the reading copy the applicant signs beside is drawn
// from the DRAFT, whose answers sit under `questionnaire`, and until Q-HM14 page 1's position and
// page 22's reason printed blank on it while the filed copy printed them.
const answersOf = (a: DriverApplication): Record<string, unknown> => questionnaireAnswersOf(a);
const str = (v: unknown): string => (v == null ? "" : String(v));
export const answer = (a: DriverApplication, id: string): string => str(answersOf(a)[id]);
export const bool = (a: DriverApplication, id: string): boolean | null => {
  const v = answersOf(a)[id];
  return typeof v === "boolean" ? v : null;
};
const rowsOf = (a: DriverApplication, id: string): Array<Record<string, unknown>> => {
  const v = answersOf(a)[id];
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
};

/** Resolve against the ANSWERS table — `packetSigningFields.ts` has the signing pages' own. */
export const push = (into: PlacedFieldValue[], id: string, text: string, label?: string): void =>
  placeValue(into, fieldLineFor(id), text, label);

/**
 * ⚠ **D-PKT14 — what page 16's unused education and reference lines print.**
 *
 * The owner's ruling, 2026-09-14: *"leave them optional but in print we should add something like
 * N/A or something that will fill there so we dont have empty lines printed."* Both lists are
 * genuinely optional — `questionnaireContract.ts` marks neither `required` — and the first
 * application ever filed, on 2026-09-14, left both empty, so blank rows are the common case rather
 * than the exceptional one.
 *
 * ⚠ **`N/A` and not a dash or a ruled strike.** The page is read by a DOT auditor and by whoever
 * files it, and an em-dash on a ruled line is a mark somebody has to interpret. `N/A` is the
 * answer the carrier's own forms use elsewhere for the same thing.
 *
 * ⚠ **It goes to these two grids and nowhere else** — `packetGrid.ts` has the reasoning, and the
 * short version is that an empty row on a REGULATED grid is already answered by a declaration the
 * applicant ticked, and filling it would put a second assertion beside the one they made.
 */
const PAGE_16_FILLER = "N/A";

export function page16(input: PacketFieldInput, into: PlacedFieldValue[], over: PacketFieldOverflow[]): void {
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
 
    PAGE_16_FILLER,
  );

  push(into, "p16.military", yesNo(bool(a, "military_service")));
  // The carrier gives `If so, when?` a 90pt rule and the answer is a free-text service record;
  // labelled for the same reason as page 2's explanation above.
  push(into, "p16.military_when", answer(a, "military_when"), P16.militaryWhen);

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
 
    PAGE_16_FILLER,
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
