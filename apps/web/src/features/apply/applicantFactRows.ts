import {
  APPLICANT_FACTS,
  CDL_CLASSES,
  EQUIPMENT_CLASSES,
  composeFiledApplication,
  partOneCorrectionWith,
  sectionOwningPath,
  type ApplicantFact,
  type ApplicationPath,
  type ApplicationSection,
  type FactInput,
  type PartOneFactsView,
  type QuestionnaireDefinition,
} from "@silvicom/shared";
import { describeField } from "./fieldLabels";

/**
 * Every answer on the office's "Applicant facts" card, read from the fact catalogue
 * (APPLICATION-FIX-PLAN F3, D-AM7; SCREEN-MAP §10).
 *
 * ── WHY FROM THE CATALOGUE ────────────────────────────────────────────────────────────────────
 * Before F3 the office corrected an application through four lists, each its own idea of what a fact
 * is: "Correct an answer" walked the saved payload and offered every value as a text box, so a date
 * was corrected by typing `2026-04-01` and a state by typing `IL` (E8); Part 1 had its own form; the
 * identity had a third; the jobs a fourth. `APPLICANT_FACTS` already says, for every fact, what kind
 * of answer it is and which door corrects it — and the parity tests hold that list to the contracts.
 * So the card is that list, laid over this application's values, and a fact added to the catalogue
 * is a row here without anybody remembering to add it.
 *
 * ── ONE ROW PER FACT, AT THE PLACE THE APPLICATION FILES IT ───────────────────────────────────
 * The row's path is the application's (`["addresses", 1, "city"]`), whatever writer holds the value.
 * On a v2 link the phone, the current street and the licences are Part 1's, so the value shown is the
 * one composition will file (`composeFiledApplication`) and the door is Part 1's correction — the
 * driver's draft copy of those is what filing throws away, and offering it would be offering a
 * correction that is undone at filing. That is one row with the right door, not two rows.
 *
 * ── WHAT IS NOT HERE YET ──────────────────────────────────────────────────────────────────────
 * - The jobs and the gaps: `OfficeJobsSection` corrects them, and they move into the card with the
 *   row add/remove (E2) in F3's next merge.
 * - The 13 facts whose catalogue `office` is `{ none }`: the drug-and-alcohol statements (note
 *   required), donor gender and EEO (replace-only), endorsements, medical card pending, the two tables,
 *   the carrier's own questions and the SSN. Each needs a door the catalogue does not yet name; they
 *   follow, and `applicantFacts.test.ts`'s inline snapshot shrinks as each opens.
 */

/** Which writer corrects this row. */
export type FactDoor = "draft" | "identity" | "part_one";

export interface FactChoice {
  value: string;
  label: string;
}

export interface FactRow {
  /** `pathKey(path)`, for v-for and the "corrected" mark. */
  key: string;
  path: ApplicationPath;
  /** The words above the driver's own control (`describeField`), or the carrier's question. */
  label: string;
  input: FactInput;
  /** The stored answer, exactly as the door takes it back. Null is "not answered". */
  value: unknown;
  door: FactDoor;
  /** The office has changed it (an `application_edits` row at this path or at its row). */
  corrected: boolean;
  section: ApplicationSection;
  choices?: readonly FactChoice[];
}

export interface FactRowsInput {
  payload: Record<string, unknown> | null | undefined;
  partOne: PartOneFactsView | null | undefined;
  edits: ReadonlyArray<{ path: ApplicationPath }>;
  questionnaire: QuestionnaireDefinition;
}

/** A path as one string, for a list key and the "corrected" mark: `["addresses",1,"city"]` → `addresses.1.city`. */
export const pathKey = (path: ApplicationPath): string => path.join(".");

const APP = "application.";
const ANSWERS = "questionnaire_answers.";
/** The draft keeps the carrier's answers under one key (`toDraftPayload`), not the filed `questionnaire_answers`. */
const DRAFT_ANSWERS = "questionnaire";
/** Corrected in `OfficeJobsSection` until the card takes rows (see the header). */
const ELSEWHERE = new Set(["employers", "employment_gaps"]);

/** A choice's options, from the constant the contract's own enum is built from. */
const CHOICES: Readonly<Record<string, readonly FactChoice[]>> = {
  cdl_class: CDL_CLASSES.map((c) => ({ value: c, label: `Class ${c}` })),
  equipment_class: EQUIPMENT_CLASSES.map((c) => ({ value: c, label: c })),
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** The current home: the address with no `to` — the row composition files Part 1's street over. */
export function currentAddressIndex(addresses: unknown): number {
  if (!Array.isArray(addresses)) return 0;
  const at = addresses.findIndex((a) => isRecord(a) && blank(a.to));
  return at < 0 ? 0 : at;
}

/**
 * The application as the office should read it: the draft, with Part 1's facts where filing puts them.
 *
 * ⚠ Other licences are Part 1's WHOLE list, not composition's: filing files only the unexpired ones,
 * but the office corrects every licence Part 1 holds (the MVR is ordered from all of them), and the
 * row's index has to be the one the Part 1 door writes back to (`partOneCorrectionWith`).
 */
function documentOf(payload: Record<string, unknown>, partOne: PartOneFactsView | null | undefined): Record<string, unknown> {
  if (!partOne) return payload;
  const addresses = Array.isArray(payload.addresses) && payload.addresses.length > 0
    ? payload.addresses
    : [{ from: null, to: null }];
  const { application } = composeFiledApplication(
    {
      phone: payload.phone, addresses, cdl_number: payload.cdl_number, cdl_state: payload.cdl_state,
      cdl_class: payload.cdl_class, cdl_expires_at: payload.cdl_expires_at,
      additional_licences: payload.additional_licences ?? [],
      prior_failed_pre_employment_test: payload.prior_failed_pre_employment_test,
    } as never,
    partOne.intake,
    partOne.licences,
    partOne.asOf,
  );
  const others = [...partOne.licences].sort((a, b) => a.position - b.position).slice(1)
    .map((l) => ({ issuing_authority: l.state_code, number: l.licence_number, expires_at: l.expires_on, kind: null }));
  return { ...payload, ...(application as Record<string, unknown>), additional_licences: others };
}

/** The door the catalogue names, resolved for this application and this row. */
function doorOf(fact: ApplicantFact, partOne: boolean, row: number | null, current: number): FactDoor | null {
  const office = fact.office;
  if (typeof office !== "string") return null;
  if (office !== "part_one") return office;
  if (!partOne) return "draft";
  // Only the CURRENT home is Part 1's; every earlier address is the driver's draft answer.
  if (fact.path.startsWith(`${APP}addresses[]`) && row !== current) return "draft";
  return "part_one";
}

export function applicantFactRows({ payload, partOne, edits, questionnaire }: FactRowsInput): FactRow[] {
  const doc = documentOf(isRecord(payload) ? payload : {}, partOne);
  const current = currentAddressIndex(doc.addresses);
  const editedAt = edits.map((e) => pathKey(e.path));
  const corrected = (key: string) => editedAt.some((e) => key === e || key.startsWith(`${e}.`));
  const out: FactRow[] = [];

  const push = (fact: ApplicantFact, path: ApplicationPath, value: unknown, door: FactDoor, label?: string, choices?: readonly FactChoice[]) => {
    // A Part 1 row Part 1 does not actually hold (an other licence's `kind`, which Part 1 never asks)
    // has no writer at all: shown, it would be a Save that can only fail.
    if (door === "part_one" && partOne && partOneCorrectionWith(partOne, path, null, current) === null) return;
    const key = pathKey(path);
    const column = String(path[path.length - 1]);
    const options = choices ?? CHOICES[column];
    out.push({
      key, path, value: value ?? null, door, input: fact.input,
      label: label ?? describeField(path),
      corrected: corrected(key),
      section: sectionOwningPath(path[0] === DRAFT_ANSWERS ? ["questionnaire_answers", ...path.slice(1)] : path) ?? "review",
      ...(options ? { choices: options } : {}),
    });
  };

  for (const fact of APPLICANT_FACTS) {
    if (!fact.path.startsWith(APP)) continue;
    const key = fact.path.slice(APP.length);

    if (key.startsWith(ANSWERS)) {
      const id = key.slice(ANSWERS.length);
      const question = questionnaire.questions.find((q) => q.id === id);
      const door = doorOf(fact, Boolean(partOne), null, current);
      if (!question || !door) continue;
      const answers = isRecord(doc[DRAFT_ANSWERS]) ? (doc[DRAFT_ANSWERS] as Record<string, unknown>) : {};
      const choices = question.choices ?? question.options?.map((o) => ({ value: o, label: o }));
      push(fact, [DRAFT_ANSWERS, id], answers[id], door, question.label, choices);
      continue;
    }

    const [name, column] = key.split("[].") as [string, string | undefined];
    const list = name.endsWith("[]") ? name.slice(0, -2) : null;
    if (ELSEWHERE.has(column ? name : (list ?? name))) continue;

    if (column === undefined && list === null) {
      const door = doorOf(fact, Boolean(partOne), null, current);
      if (door) push(fact, [name], doc[name], door);
      continue;
    }

    const rows = doc[list ?? name];
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, i) => {
      const door = doorOf(fact, Boolean(partOne), i, current);
      if (!door) return;
      if (column === undefined) push(fact, [list!, i], row, door); // a list of plain strings (other names)
      else if (isRecord(row)) push(fact, [name, i, column], row[column], door);
    });
  }
  return byRow(out);
}

/**
 * Keep each row's answers together: "Address 1" street, city, ZIP, months, then "Address 2". The
 * catalogue is ordered by FACT (every address's street, then every address's city), so read straight
 * it printed "Address 1 · ZIP, Address 2 · ZIP, Address 1 · From…" — found in the F3 browser pass.
 * A list is placed where its first answer was; inside it, by row, then the catalogue's column order.
 */
function byRow(rows: FactRow[]): FactRow[] {
  const out: FactRow[] = [];
  const placed = new Set<string>();
  rows.forEach((row) => {
    const [list, at] = row.path;
    if (typeof at !== "number") { out.push(row); return; }
    if (placed.has(String(list))) return;
    placed.add(String(list));
    out.push(...rows
      .map((r, order) => ({ r, order }))
      .filter(({ r }) => r.path[0] === list && typeof r.path[1] === "number")
      .sort((a, b) => (a.r.path[1] as number) - (b.r.path[1] as number) || a.order - b.order)
      .map(({ r }) => r));
  });
  return out;
}

/** The rows grouped by the section the driver met them in, in the application's order. */
export function factSections(rows: readonly FactRow[]): Array<{ section: ApplicationSection; rows: FactRow[] }> {
  const out: Array<{ section: ApplicationSection; rows: FactRow[] }> = [];
  for (const row of rows) {
    const group = out.find((g) => g.section === row.section);
    if (group) group.rows.push(row);
    else out.push({ section: row.section, rows: [row] });
  }
  return out;
}

/** The office looking for one answer among sixty, by any word in its label. */
export function matchingFacts(rows: readonly FactRow[], query: string): FactRow[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? [...rows] : rows.filter((r) => r.label.toLowerCase().includes(needle));
}
