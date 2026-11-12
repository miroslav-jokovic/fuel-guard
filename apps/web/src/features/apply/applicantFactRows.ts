import {
  APPLICANT_FACTS,
  APPLICATION_SECTION_ORDER,
  CDL_CLASSES,
  DONOR_GENDERS,
  ENDORSEMENT_CODES,
  LICENCE_KINDS,
  EQUIPMENT_CLASSES,
  carrierQuestionnaire,
  composeFiledApplication,
  currentEditPaths,
  partOneCorrectionWith,
  sectionOwningPath,
  type ApplicantFact,
  type ApplicantIdentityKey,
  type ApplicationPath,
  type ApplicationSection,
  type CarrierQuestionStamp,
  type FactInput,
  type FactRule,
  type PartOneAnswersView,
  type PartOneFactsView,
  type QuestionnaireDefinition,
} from "@silvicom/shared";
import type { TypedDateKind } from "@silvicom/ui";
import { describeField } from "./fieldLabels";
import { APPLY_COPY } from "./strings";

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
 * ── THE JOBS AND THE GAPS ARE ON THE CARD, BUT NOT AS ROWS ───────────────────────────────────
 * They are the card's Employment group, drawn by `OfficeJobsSection` (the timeline and the one
 * employer form) under the group's own rows — so the office finds every answer on the one card, and a
 * job still has ONE editor (F3c part 2, owner D-AM7: "do not keep two editors of one answer").
 * Rows would be the wrong shape for them: a job is added, removed and corrected by its KEY
 * (`add_employer` / `remove_employer`, Q-AX7), a gap is explained against the dates the timeline
 * measures, and the PSP record is read against the jobs as a whole — none of it a single answer with
 * a before and after. `ELSEWHERE` keeps them out of the rows; `jobsMatch` keeps the search honest.
 *
 * ── THE CARRIER'S OWN QUESTIONS (step 5) ──────────────────────────────────────────────────────
 * One catalogue fact, `carrier_answers`, laid out once per question on THIS applicant's stamp (the
 * review's `carrierQuestions`, never the live list — D-CQ2), worded as stamped and corrected with the
 * control the applicant's form answered it with (`questionControl`).
 *
 * ── WHAT IS NOT HERE YET ──────────────────────────────────────────────────────────────────────
 * The facts whose catalogue `office` is `{ none }` (`applicantFacts.test.ts`'s inline snapshot): the SSN,
 * ruled on 2026-11-11 (Q-AM3, Q-AM17) and next in the plan's list.
 */

/** Which writer corrects this row. */
export type FactDoor = "draft" | "identity" | "part_one" | "part_one_answer";

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
  /** Q-AM13: a `statement` needs the office's reason; a `replace_only` answer is never shown (`given` says whether one exists). */
  rule?: FactRule;
  given?: boolean;
  /** F3c part 2: a row of a carrier question answered as a table — its columns, as the editor asks them. */
  columns?: readonly TableColumn[];
  /** An optional question's stored "I am not answering this" — offered beside the control, as the form does. */
  skip?: FactChoice;
}

/** One column of a table answer, with the card's input kind for its question kind. */
export interface TableColumn {
  id: string;
  label: string;
  input: FactInput;
  /** A date's own rule — a date of birth is an adult's, in the past (`identityColumns`). */
  dateKind?: TypedDateKind;
}

export interface FactRowsInput {
  payload: Record<string, unknown> | null | undefined;
  partOne: PartOneFactsView | null | undefined;
  /** The office's corrections; `before`/`after`/`editedAt` let a row removal be replayed (E2). */
  edits: ReadonlyArray<{ path: ApplicationPath; before?: unknown; after?: unknown; editedAt?: string }>;
  questionnaire: QuestionnaireDefinition;
  /** F3: Part 1's own answers (statements, medical card pending, endorsements; the donor gender only as given). */
  partOneAnswers?: PartOneAnswersView | null;
  /** Step 5: the carrier's own questions THIS applicant was asked — the invitation's stamp. */
  carrier?: CarrierQuestionStamp | null;
  /**
   * Step 6: the identity on the applicant's record (the review's `identity`). Laid over the draft's copy, as
   * filing lays it (`identityOnRecord`, D-AF8) — before the first save there is no draft to show it by.
   */
  identity?: Partial<Record<ApplicantIdentityKey, string>> | null;
}

/** A path as one string, for a list key and the "corrected" mark: `["addresses",1,"city"]` → `addresses.1.city`. */
export const pathKey = (path: ApplicationPath): string => path.join(".");

const APP = "application.";
const ANSWERS = "questionnaire_answers.";
const CARRIER_ANSWERS = "carrier_answers";
/** The draft keeps the carrier's answers under one key (`toDraftPayload`), not the filed `questionnaire_answers`. */
const DRAFT_ANSWERS = "questionnaire";
/** The card's Employment group draws these with the jobs timeline, not as rows (see the header). */
const ELSEWHERE = new Set(["employers", "employment_gaps"]);

/** A choice's options, from the constant the contract's own enum is built from, in the driver's words. */
export const CHOICES = (): Readonly<Record<string, readonly FactChoice[]>> => ({
  cdl_class: CDL_CLASSES.map((c) => ({ value: c, label: `Class ${c}` })),
  equipment_class: EQUIPMENT_CLASSES.map((c) => ({ value: c, label: c })),
  donor_gender: DONOR_GENDERS.map((g) => ({ value: g, label: APPLY_COPY.partOne.screening.genderOptions[g] })),
  cdl_endorsements: ENDORSEMENT_CODES.map((c) => ({ value: c, label: APPLY_COPY.partOne.licence.endorsementLabels[c] })),
  // P3: an other licence's type (`additional_licences[].kind`), in the words its screen asks it with.
  kind: LICENCE_KINDS.map((k) => ({ value: k, label: APPLY_COPY.partOne.otherLicences.kindOptions[k] })),
});

/**
 * Where a Part 1 answer that is not composed into the application sits on the card: beside the
 * application's own facts of the same kind. Not a contract section — these keys belong to no section of
 * the application, because the application does not carry them.
 */
const PART_ONE_SECTION: Readonly<Record<string, ApplicationSection>> = {
  dot_program_30d: "safety",
  dot_tested_6m: "safety",
  dot_random_12m: "safety",
  donor_gender: "identity",
  medical_card_pending: "documents",
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
      cdl_class: payload.cdl_class, cdl_endorsements: payload.cdl_endorsements, cdl_expires_at: payload.cdl_expires_at,
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
  // The SSN's door is its own row (`ApplicantSsnRow`), never a catalogue row: it is never shown whole here.
  if (typeof office !== "string" || office === "ssn") return null;
  // A composed fact (§40.25(j)) is the draft's own answer on a legacy link, and Part 1's on a v2 one.
  if (office === "part_one_answer") return partOne ? "part_one_answer" : "draft";
  if (office !== "part_one") return office;
  if (!partOne) return "draft";
  // Only the CURRENT home is Part 1's; every earlier address is the driver's draft answer.
  if (fact.path.startsWith(`${APP}addresses[]`) && row !== current) return "draft";
  return "part_one";
}

export function applicantFactRows({ payload, partOne, edits, questionnaire, partOneAnswers, carrier, identity }: FactRowsInput): FactRow[] {
  // The record's identity last, as filing lays it: only the values it holds, never a blank over an answer.
  const doc: Record<string, unknown> = { ...documentOf(isRecord(payload) ? payload : {}, partOne), ...(identity ?? {}) };
  const current = currentAddressIndex(doc.addresses);
  // ⚠ Tolerant of a response without `edits` (an older API, or a refetch racing a write): the card
  // renders inside the drawer's body, and one missing list must not take the whole record down.
  // E2: where each correction points NOW — a removal since moves the rows after it up, takes its own
  // row's corrections with it, and marks nothing itself (`currentEditPaths`).
  const editedAt = currentEditPaths(Array.isArray(edits) ? edits : [])
    .filter((e) => !e.gone)
    .map((e) => pathKey(e.path));
  const corrected = (key: string) => editedAt.some((e) => key === e || key.startsWith(`${e}.`));
  const out: FactRow[] = [];

  /** `extra`: what a question says of itself and the catalogue cannot — its words, control, choices and skip. */
  const push = (fact: ApplicantFact, path: ApplicationPath, value: unknown, door: FactDoor, extra: Partial<FactRow> = {}) => {
    // A Part 1 row Part 1 does not actually hold (an other licence's `kind`, which Part 1 never asks)
    // has no writer at all: shown, it would be a Save that can only fail.
    if (door === "part_one" && partOne && partOneCorrectionWith(partOne, path, null, current) === null) return;
    const key = pathKey(path);
    const column = String(path[path.length - 1]);
    const { label, choices, ...more } = extra;
    const options = choices ?? CHOICES()[column];
    out.push({
      key, path, value: value ?? null, door, input: fact.input,
      label: label ?? describeField(path),
      corrected: corrected(key),
      section: PART_ONE_SECTION[key]
        ?? sectionOwningPath(path[0] === DRAFT_ANSWERS ? ["questionnaire_answers", ...path.slice(1)] : path) ?? "review",
      ...(options ? { choices: options } : {}),
      ...(fact.rule ? { rule: fact.rule } : {}),
      ...more,
    });
  };

  for (const fact of APPLICANT_FACTS) {
    // F3: a Part 1 answer the application does not carry (no `through`) is its own row on a v2 link.
    // ⚠ The donor gender's value is never here: the API sends only whether one was given (Q-AM13).
    if (fact.path.startsWith("intake.")) {
      const composed = !Array.isArray(fact.packet) && "through" in fact.packet;
      if (composed || fact.office !== "part_one_answer" || !partOne || !partOneAnswers) continue;
      const key = fact.path.slice("intake.".length).replace(/\[\]$/, "");
      if (fact.rule === "replace_only") {
        push(fact, [key], null, "part_one_answer");
        out[out.length - 1]!.given = key === "donor_gender" && partOneAnswers.donorGenderGiven;
      } else {
        push(fact, [key], (partOneAnswers as unknown as Record<string, unknown>)[key], "part_one_answer");
      }
      continue;
    }
    if (!fact.path.startsWith(APP)) continue;
    const key = fact.path.slice(APP.length);
    // F2b: the endorsements are asked only in Part 1, so a legacy link (no Part 1) has none to show or
    // correct — a row there would be a Save with no writer, as Part 1's own answers are skipped above.
    if (key === "cdl_endorsements[]" && !partOne) continue;

    if (key.startsWith(ANSWERS)) {
      const id = key.slice(ANSWERS.length).replace(/\[\]$/, "");
      const question = questionnaire.questions.find((q) => q.id === id);
      const door = doorOf(fact, Boolean(partOne), null, current);
      if (!question || !door) continue;
      const answers = isRecord(doc[DRAFT_ANSWERS]) ? (doc[DRAFT_ANSWERS] as Record<string, unknown>) : {};
      // F3c part 2: a table answer is one row per row the driver gave, each corrected whole — a cell
      // would be four path segments deep (`applicationPathSchema` allows three), and a row is what the
      // driver typed as one thing.
      if (question.kind === "table") {
        const given = Array.isArray(answers[id]) ? (answers[id] as unknown[]) : [];
        given.forEach((row, i) => push(fact, [DRAFT_ANSWERS, id, i], row, door, { columns: tableColumns(question) }));
        continue;
      }
      push(fact, [DRAFT_ANSWERS, id], answers[id], door, {
        label: question.label,
        choices: question.choices ?? question.options?.map((o) => ({ value: o, label: o })),
        ...(question.skip ? { skip: question.skip } : {}),
      });
      continue;
    }

    if (key === CARRIER_ANSWERS) {
      const door = doorOf(fact, Boolean(partOne), null, current);
      const answers = isRecord(doc[CARRIER_ANSWERS]) ? (doc[CARRIER_ANSWERS] as Record<string, unknown>) : {};
      if (!door || !carrier) continue;
      for (const q of carrierQuestionnaire(carrier).questions) {
        push(fact, [CARRIER_ANSWERS, q.id], answers[q.id], door, {
          label: q.label,
          input: questionControl(q.kind),
          ...(q.choices ? { choices: q.choices } : {}),
          ...(q.skip ? { skip: q.skip } : {}),
        });
      }
      continue;
    }

    const [name, column] = key.split("[].") as [string, string | undefined];
    const list = name.endsWith("[]") ? name.slice(0, -2) : null;
    if (ELSEWHERE.has(column ? name : (list ?? name))) continue;

    // A set (the endorsements, F2b) is one answer, ticked as a whole — not a row per item like other names.
    if (column === undefined && (list === null || fact.input === "multi_choice")) {
      const door = doorOf(fact, Boolean(partOne), null, current);
      if (door) push(fact, [list ?? name], doc[list ?? name], door);
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

/**
 * The card's control for one of the carrier's own questions: the one the applicant's form answered it
 * with (`QuestionnaireFields`). ⚠ A date and a number are typed into a plain box there and stored as typed,
 * so they are here too — a date picker would write a different string than the one the applicant's form
 * reads back, and the two would stop matching (D-AM7).
 */
export function questionControl(kind: string): FactInput {
  const CONTROL: Record<string, FactInput> = { boolean: "yesno", longtext: "longtext", select: "choice", number: "count" };
  return CONTROL[kind] ?? "text";
}

/** A table question's columns, each with the card's control for its kind. */
export function tableColumns(question: QuestionnaireDefinition["questions"][number]): TableColumn[] {
  const INPUT: Record<string, FactInput> = { boolean: "yesno", number: "count" };
  return (question.columns ?? []).map((c) => ({ id: c.id, label: c.label, input: INPUT[c.kind] ?? "text" }));
}

/** The rows grouped by the section the driver met them in, in the application's order. */
export function factSections(rows: readonly FactRow[]): Array<{ section: ApplicationSection; rows: FactRow[] }> {
  // In the application's own section order — not first appearance, which put Part 1's answers (first in
  // the catalogue) ahead of "About you".
  return APPLICATION_SECTION_ORDER
    .map((section) => ({ section, rows: rows.filter((r) => r.section === section) }))
    .filter((g) => g.rows.length > 0);
}

/** The office looking for one answer among sixty, by any word in its label. */
export function matchingFacts(rows: readonly FactRow[], query: string): FactRow[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? [...rows] : rows.filter((r) => r.label.toLowerCase().includes(needle));
}

/**
 * Whether the jobs belong in a search's results. ⚠ Without it, typing "employer" into "Find an answer"
 * hid the very jobs it named: the timeline is not rows, so the row filter could never match it. A job
 * matches by any of the employer form's labels, by the employer's name, or by the words a recruiter
 * says for the whole of it ("job", "gap", "employment").
 */
export function jobsMatch(query: string, employers: ReadonlyArray<Record<string, unknown>>): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const labels = APPLICANT_FACTS
    .filter((f) => /^application\.(employers|employment_gaps)\[\]\./.test(f.path))
    .map((f) => {
      const [list, column] = f.path.slice(APP.length).split("[].") as [string, string];
      return describeField([list, 0, column]);
    });
  const names = employers.map((e) => (typeof e.employer_name === "string" ? e.employer_name : ""));
  return ["job", "jobs", "gap", "employment", "employer", ...labels, ...names]
    .some((text) => text.toLowerCase().includes(needle));
}
