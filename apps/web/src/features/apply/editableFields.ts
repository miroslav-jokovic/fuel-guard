import {
  PART_ONE_COMPOSED_KEYS,
  PART_ONE_STREET_KEYS,
  type ApplicationPath,
  type QuestionnaireDefinition,
} from "@silvicom/shared";
import { describeField } from "./fieldLabels";

/**
 * Every answer the office can correct, addressed the way the contract addresses it (F4, D-AX13).
 *
 * ── WHY THIS WALKS THE SAVED PAYLOAD AND NOT THE DRAFT TYPE ───────────────────────────────────
 * The office edits `application_drafts.payload` one path at a time, and the server writes that path
 * into that same object. So the list of what can be edited has to come from the object itself: a
 * field the payload does not carry is a field an edit would CREATE, and creating `addresses[3]` by
 * typing into a box the driver never filled is not a correction, it is an invention. Walking the
 * payload means the office is offered the answers that exist, and nothing else.
 *
 * ⚠ It is also why rows are not padded. `fromDraftPayload` floors an empty application at one blank
 * address and one blank employer so the FORM has something to render; doing the same here would
 * offer the office a row the payload has no array for, and the server would refuse the write with a
 * validation error nobody could act on.
 *
 * ── AND WHY EVERY LABEL COMES FROM `describeField` ────────────────────────────────────────────
 * One vocabulary for the error a driver sees, the correction an office makes and the mark the
 * signing screen puts beside it. `["employers", 0, "city"]` is "Employer 1 · City" everywhere, in
 * the words the field's own control prints above itself — so a recruiter on the phone and a driver
 * on their handset are talking about the same box.
 */

export interface EditableField {
  path: ApplicationPath;
  /** "Employer 1 · City" — the field, in the words the driver's own screen used. */
  label: string;
  /** The stored answer, exactly as it will be sent back if it is changed. */
  value: string | boolean;
  kind: "text" | "boolean";
}

/**
 * Not answers, and not the office's to change.
 *
 * `certified` and `signed_name` are the §391.21(b) certification — an act the applicant performs on
 * the finished document, which is why autosave does not carry them either. `ssn` never enters a
 * draft at all (D-APP3). The two `questionnaire_*` keys belong to the certified document rather than
 * to the draft, which holds the working answers under `questionnaire`.
 */
const NOT_AN_ANSWER = new Set([
  "certified",
  "signed_name",
  "ssn",
  "questionnaire_version",
  "questionnaire_answers",
  // C3c2c2: the applicant's note to the office. Theirs to write; the drawer shows it, never corrects it.
  "correction_note",
]);

/** The carrier's own answers, which live under one key and are labelled by their question. */
const QUESTIONNAIRE = "questionnaire";

const scalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function field(path: ApplicationPath, value: string | number | boolean, label?: string): EditableField {
  return {
    path,
    label: label ?? describeField(path),
    value: typeof value === "boolean" ? value : String(value),
    kind: typeof value === "boolean" ? "boolean" : "text",
  };
}

/**
 * The carrier's own questions, labelled by the definition that asked them.
 *
 * ⚠ A `table` answer is skipped, and deliberately: one cell of it is four segments deep
 * (`questionnaire.q.0.column`) and `applicationPathSchema` allows three, so an edit to it could not
 * be addressed at all. Rather than offer a control whose write the server would refuse, the drawer
 * says the answer has to go back to the driver — which for a grid of rows is the honest answer.
 */
function questionnaireFields(
  answers: Record<string, unknown>,
  questionnaire: QuestionnaireDefinition,
): EditableField[] {
  const out: EditableField[] = [];
  for (const question of questionnaire.questions) {
    const value = answers[question.id];
    if (!scalar(value)) continue;
    out.push(field([QUESTIONNAIRE, question.id], value, question.label));
  }
  return out;
}

/**
 * Is this path one a v2 filing takes from Part 1 rather than from the draft (C3c2c2, Q-AW34)? Composition's
 * own key lists, so the two cannot disagree: every composed key, except that of `addresses` only the
 * CURRENT entry's street is Part 1's (its months, and every earlier address, are the applicant's).
 *
 * ⚠ Unconditional: composition skips a key Part 1 left blank, but Part 1 cannot finish with the phone,
 * the address, the CDL or §40.25(j) blank, so on a finished Part 1 each of these is Part 1's.
 */
function composedFromPartOne(key: string, row?: Record<string, unknown>, column?: string): boolean {
  if (!(PART_ONE_COMPOSED_KEYS as readonly string[]).includes(key)) return false;
  if (key !== "addresses") return true;
  const current = row !== undefined && (row.to === null || row.to === undefined || String(row.to).trim() === "");
  return current && (PART_ONE_STREET_KEYS as readonly string[]).includes(column ?? "");
}

export function editableFields(
  payload: Record<string, unknown> | null | undefined,
  questionnaire: QuestionnaireDefinition,
  /** A v2 application whose Part 1 facts filing composes over the draft — see `composedFromPartOne`. */
  partOne = false,
): EditableField[] {
  if (!payload || typeof payload !== "object") return [];
  const out: EditableField[] = [];

  // Payload order, which is the order `toDraftPayload` writes and therefore the order the driver
  // was asked — identity, then where they lived, then the licence, then the jobs.
  for (const [key, value] of Object.entries(payload)) {
    if (NOT_AN_ANSWER.has(key)) continue;

    if (key === QUESTIONNAIRE) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out.push(...questionnaireFields(value as Record<string, unknown>, questionnaire));
      }
      continue;
    }

    if (partOne && key !== "addresses" && composedFromPartOne(key)) continue;

    if (scalar(value)) {
      out.push(field([key], value));
      continue;
    }

    if (!Array.isArray(value)) continue;
    value.forEach((row, i) => {
      // `other_names` is an array of plain strings; everything else is an array of rows.
      if (scalar(row)) {
        out.push(field([key, i], row));
        return;
      }
      if (!row || typeof row !== "object") return;
      for (const [column, cell] of Object.entries(row as Record<string, unknown>)) {
        if (!scalar(cell)) continue;
        if (partOne && composedFromPartOne(key, row as Record<string, unknown>, column)) continue;
        out.push(field([key, i, column], cell));
      }
    });
  }

  return out;
}

/** The office looking for one field among sixty, by any word in its name. */
export function matchingFields(fields: readonly EditableField[], query: string): EditableField[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...fields];
  return fields.filter((f) => f.label.toLowerCase().includes(needle));
}

/** The paths already corrected, so the list can mark them. `["employers",0,"city"]` → a set key. */
export const pathKey = (path: ApplicationPath): string => path.join(".");
