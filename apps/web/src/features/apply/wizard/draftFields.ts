import {
  applicationAddressSchema, applicationEmploymentGaps, earliestResidenceMonth, EQUIPMENT_CLASS_LABELS, rowListOf, WIZARD_SCREENS,
  type ApplicationEmployer, type FactPath, type RowKind, type WizardScreenId,
} from "@silvicom/shared";
import {
  emptyAccident, emptyAddress, emptyEmployer, emptyEquipment, emptyViolation, employerIsBlank, toAddressPayload, toApplication,
  type ApplicationDraft, type DraftAddress, type DraftEmployer, type DraftEquipment,
} from "@/features/apply/draft";
import { checkEmployer } from "@/features/apply/employerCheck";
import { reconcileGapExplanations } from "@/features/apply/employmentProgress";
import { describeField, fieldId, messageFor, valueAt, type FieldPath } from "@/features/apply/fieldLabels";
import { APPLY_COPY } from "@/features/apply/strings";
import { v2FilingIssues, type SectionIssue } from "@/features/apply/useApplicationWizard";
import type { FieldCopy, WizardBinding } from "./wizardBinding";

/**
 * Stage 2's facts in Part 2's draft (F4 PR 1b-1): where each answer lives, the words its screen shows,
 * and the problem the task's own check found with it.
 *
 * ── WHERE THE ANSWER LIVES — derived ──────────────────────────────────────────────────────────
 * `application.<key>` is `draft.<key>`, and a row's column `application.<list>[].<col>` is
 * `draft.<list>[row].<col>`: the draft holds the contract's keys (`draftShape.ts`), so nothing is mapped
 * by hand. Each task that joins the walk adds only its words below.
 *
 * ── TWO RULES, BOTH READ FROM THE CATALOGUE ───────────────────────────────────────────────────
 * - **A gate** (`FactAsk.gate`) answers whether its list has rows, and stores the list's "none"
 *   declaration: No declares none and clears the list; Yes opens the first row. `SafetyHistoryFields`'
 *   rule since C3c2c1, kept — a hidden row that still files beside "there were none" is the worse defect.
 * - **An answer that closes a conditional screen clears it.** A screen asked `when` another answer is X
 *   is emptied when that answer stops being X — "No" to "ever denied?" empties the description, as the
 *   section component did, so a description of a denial never files beside "never denied".
 *
 * ── THE PROBLEM SHOWN IS THE TASK'S OWN CHECK'S ───────────────────────────────────────────────
 * `error` reads the issues `validateSection` found (the wizard's list), by the same DOM id the send
 * summary focuses (`fieldId`). So what a screen shows and what "Save and continue" refuses are one list.
 */

/**
 * A list's blank row, as the section components made it — so a new row is the same row either way.
 *
 * ⚠ An earlier home begins where the homes already given end (F4 PR 1b-3): its "until" is the earliest
 * month any of them starts in, because that is the month the driver moved out of it. So the driver types
 * one month per home, not two, and the months cannot leave a gap by a slip of the hand. It is an answer
 * like any other on the screen, and theirs to change.
 */
const NEW_ROW: Readonly<Record<string, (rows: readonly Record<string, unknown>[]) => Record<string, unknown>>> = {
  accidents: () => ({ ...emptyAccident() }),
  violations: () => ({ ...emptyViolation() }),
  addresses: (rows) => ({ ...emptyAddress(), to: earliestResidenceMonth(rows as unknown as DraftAddress[]) ?? "" }),
  employers: () => ({ ...emptyEmployer() }),
};

// ── "Where you have worked" (F4 PR 1b-4) ─────────────────────────────────────────────────────────

/** The one DOT question (Q-AM9 (a)): its fact, and the two it answers with it. */
const DOT = "application.employers[].dot_regulated";
const DOT_ANSWERS = ["dot_regulated", "subject_to_fmcsr", "safety_sensitive"] as const;
/** The third answer, which is the office's to resolve (`dot_not_sure`). */
export const NOT_SURE = "not_sure";
/** The equipment's classes are PICKED, each pick a row (`FactAsk.picksRows`, SCREEN-MAP 2.16). */
const EQUIPMENT_CLASS = "application.equipment_experience[].equipment_class";
const DROVE = "application.employers[].operated_cmv";
/** SCREEN-MAP 2.11a: a driving job's position is filed as this, and never asked. */
export const DRIVER_POSITION = "Driver";

/**
 * The gaps a filing asks about, as the draft's rows — re-keyed whenever a job's dates move, so the walk's
 * gap screens are exactly the gaps `applicationV2FilingIssues` refuses on (`ApplyEmploymentFields`' watch,
 * moved here with the task). Writes only when something changed, so opening the task dirties nothing.
 */
export function settleEmploymentGaps(draft: ApplicationDraft, asOf: string | null): void {
  if (!asOf) return;
  const filed = (toApplication(draft) as { employers: ApplicationEmployer[] }).employers;
  const gaps = filed.length === 0 && !draft.declares_no_employment ? [] : applicationEmploymentGaps(filed, asOf);
  const next = reconcileGapExplanations(draft.employment_gaps, gaps);
  if (JSON.stringify(next) !== JSON.stringify(draft.employment_gaps)) draft.employment_gaps = next;
}

/**
 * Which address is the home lived in NOW: the first with no end month — composition's own test
 * (`composeFiledApplication` lays Part 1's street over a row with no `to`), so the row the walk shows
 * and does not ask is exactly the row filing replaces. Every other row is an earlier home.
 */
export const currentAddressRow = (addresses: readonly { to?: string | null }[]): number =>
  addresses.findIndex((a) => (a.to ?? "").trim() === "");

/**
 * The draft path of a fact on a row (or the whole fact, off a row) — the path issues are reported at. A
 * whole list (`application.other_names[]`) is its key; the SSN (`ssn`, its own route) is the draft's
 * `ssn`, the typed digits `SsnField` holds until it saves them.
 */
export function draftPath(path: FactPath, row?: number): FieldPath {
  const list = rowListOf(path);
  if (list !== undefined) return [list, row ?? 0, path.slice(`application.${list}[].`.length)];
  return [path.replace(/^application\./, "").replace(/\[\]$/, "")];
}

/** Is `path` at or under `prefix`? A problem with one other name (`other_names.1`) is the list's screen's. */
export const pathUnder = (path: readonly (string | number)[], prefix: readonly (string | number)[]): boolean =>
  prefix.length <= path.length && prefix.every((p, i) => path[i] === p);

/** The gate a fact is asked as, if any — `declares_no_accidents` → `accidents`. */
const gateOf = (path: FactPath): string | undefined =>
  WIZARD_SCREENS.flatMap((s) => s.fields).find((f) => f.fact.path === path && f.ask.gate)?.ask.gate;

/** Every fact asked only while another answer holds, by that answer's path. */
const dependants = (path: FactPath) => WIZARD_SCREENS.filter((s) => s.when?.fact === path);

/** What "empty" is for a fact's control — the value the draft starts it at. */
const emptyOf = (current: unknown): unknown => (typeof current === "boolean" || current === null ? null : "");

const fieldCopy = (): Record<FactPath, FieldCopy> => {
  const safety = APPLY_COPY.safety;
  const walk = safety.walk;
  const you = APPLY_COPY.identity;
  const home = APPLY_COPY.addresses;
  const work = APPLY_COPY.employment;
  const job = work.walk;
  return {
    // "Where you have lived" (F4 PR 1b-3), in the section component's words. Q-AM8 (a): the street and
    // the ZIP say the office completes them.
    "application.addresses[].line1": { label: home.line1, hint: home.officeCompletes, autocomplete: "off" },
    "application.addresses[].line2": { label: home.line2, hint: home.optional, autocomplete: "off" },
    "application.addresses[].city": { label: home.city, autocomplete: "off" },
    "application.addresses[].state": { label: home.state },
    "application.addresses[].postal_code": { label: home.postal_code, hint: home.officeCompletes, autocomplete: "off" },
    "application.addresses[].from": { label: home.walk.from, hint: home.fromHint },
    "application.addresses[].to": { label: home.walk.to, hint: home.fromHint },
    // "Where you have worked" (F4 PR 1b-4).
    "application.declares_no_employment": { label: job.any, hint: job.anyHint },
    "application.employers[].employer_name": { label: job.name, hint: work.employerHint, autocomplete: "off" },
    "application.employers[].city": { label: job.city, autocomplete: "off" },
    "application.employers[].state": { label: job.state, hint: job.placeHint },
    "application.employers[].started_on": { label: job.from },
    "application.employers[].ended_on": { label: job.to, hint: job.toHint },
    [DROVE]: { label: job.drove, hint: work.droveTruckHint },
    "application.employers[].position_held": { label: job.position, autocomplete: "off" },
    [DOT]: { label: job.dot, hint: job.dotHint, options: { yes: work.yes, no: work.no, [NOT_SURE]: job.notSure } },
    "application.employers[].reason_for_leaving": { label: job.reason, hint: job.reasonHint },
    "application.employment_gaps[].explanation": { label: job.gap, hint: job.gapHint },
    [EQUIPMENT_CLASS]: { label: job.equipment, hint: job.equipmentHint, options: EQUIPMENT_CLASS_LABELS },
    "application.equipment_experience[].equipment_type": { label: job.equipmentType, hint: work.equipmentTypeHint },
    "application.equipment_experience[].from": { label: job.equipmentFrom, hint: work.equipmentMonthHint },
    "application.equipment_experience[].to": { label: job.equipmentTo, hint: work.equipmentToHint },
    "application.equipment_experience[].approx_miles": { label: job.equipmentMiles, hint: work.equipmentMilesHint },
    "application.experience": { label: job.experience, hint: job.experienceHint },
    // "About you" (F4 PR 1b-2), in the section component's words.
    "application.first_name": { label: you.first_name, autocomplete: "given-name" },
    "application.middle_name": { label: you.middle_name, hint: you.optional, autocomplete: "additional-name" },
    "application.last_name": { label: you.last_name, autocomplete: "family-name" },
    "application.other_names[]": { label: you.otherNames, hint: you.otherNamesHint },
    "application.email": { label: you.email, autocomplete: "email" },
    ssn: { label: you.ssn, hint: you.ssnHint },
    "application.declares_no_accidents": { label: safety.accidentsQuestion },
    "application.accidents[].occurred_on": { label: walk.accidentDate },
    "application.accidents[].nature": { label: walk.accidentNature, hint: walk.accidentNatureHint },
    "application.accidents[].fatalities": { label: walk.fatalities },
    "application.accidents[].injuries": { label: walk.injuries },
    "application.accidents[].hazmat_spill": { label: walk.hazmatSpill },
    "application.declares_no_violations": { label: safety.violationsQuestion, hint: safety.violationsQuestionHint },
    "application.violations[].occurred_on": { label: walk.violationDate },
    "application.violations[].offence": { label: walk.offence, hint: walk.quickPickHint },
    "application.violations[].state": { label: walk.violationState },
    "application.violations[].penalty": { label: walk.penalty, hint: walk.quickPickHint },
    "application.licence_ever_denied": { label: safety.deniedQuestion },
    "application.licence_denial_detail": { label: safety.denialDetail, hint: safety.denialDetailHint },
    "application.licence_suspended": { label: safety.suspendedQuestion },
    "application.licence_suspension_detail": { label: safety.suspensionDetail, hint: safety.suspensionDetailHint },
  };
};

/** A fact's words where one screen asks it differently from another (`WizardBinding.copy`). */
const screenCopy = (): Partial<Record<WizardScreenId, Record<FactPath, FieldCopy>>> => ({
  "addresses.moved_in": {
    "application.addresses[].from": { label: APPLY_COPY.addresses.walk.movedIn, hint: APPLY_COPY.addresses.fromHint },
  },
});

/** The paths Part 2's page can answer — what the binding test holds the catalogue's Stage 2 screens to. */
export const DRAFT_BOUND_PATHS = (): FactPath[] => Object.keys(fieldCopy());

type Rows = Record<string, unknown>[];

/** Part 2's draft, as the generated screens read and write it. */
export function draftBinding(
  draft: () => ApplicationDraft,
  issues: () => readonly SectionIssue[],
  /** The carrier's day on a v2 link — what a job's own filing rules are judged on. */
  v2AsOf: () => string | null = () => null,
): WizardBinding {
  const doc = (): Record<string, unknown> => draft() as unknown as Record<string, unknown>;
  const rows = (list: string): Rows => (doc()[list] as Rows | undefined) ?? [];

  /**
   * Where a fact's problem is reported. Mostly its draft path; two are not: a gap's explanation is keyed
   * by the gap's start date (`employment_gaps.<from>`, the filing's own path — the gaps are computed, not
   * a list anybody typed), and the equipment's picks are the whole list's (`experience_given`).
   */
  function pathAt(fact: FactPath, row?: number): FieldPath {
    if (fact === EQUIPMENT_CLASS) return ["equipment_experience"];
    if (rowListOf(fact) === "employment_gaps") return ["employment_gaps", String(rows("employment_gaps")[row ?? 0]?.from ?? "")];
    return draftPath(fact, row);
  }

  function read(path: FactPath, row?: number): unknown {
    const gate = gateOf(path);
    if (gate !== undefined) {
      // Tri-state from what storage holds: declared none is No, a row is Yes, neither is unanswered.
      if (doc()[path.slice("application.".length)] === true) return false;
      return rows(gate).length > 0 ? true : null;
    }
    // The classes picked are the rows the list holds, in the order they were picked.
    if (path === EQUIPMENT_CLASS) return rows("equipment_experience").map((r) => r.equipment_class).filter((c) => c !== "");
    const [key, at, column] = draftPath(path, row);
    if (column === undefined) return doc()[key as string];
    const found = rows(key as string)[at as number];
    // Q-AM9 (a): "Not sure" is the question's third answer, stored beside the three it leaves unanswered.
    if (path === DOT && found?.dot_not_sure === true && found.dot_regulated === null) return NOT_SURE;
    return found?.[column as string];
  }

  function write(path: FactPath, value: unknown, row?: number): void {
    const gate = gateOf(path);
    if (gate !== undefined) {
      const yes = value === true;
      doc()[path.slice("application.".length)] = value === false;
      if (value === false) doc()[gate] = [];
      else if (yes && rows(gate).length === 0) doc()[gate] = [NEW_ROW[gate]!([])];
      return;
    }
    if (path === EQUIPMENT_CLASS) {
      // A pick kept keeps its row and everything typed on it; a new pick is a blank row of that class.
      const kept = rows("equipment_experience") as unknown as DraftEquipment[];
      doc().equipment_experience = (value as string[]).map((c) =>
        kept.find((r) => r.equipment_class === c) ?? { ...emptyEquipment(), equipment_class: c as DraftEquipment["equipment_class"] });
      return;
    }
    if (path === DOT) {
      // One question, three answers (Q-AM9 (a)): Yes or No is all three; "Not sure" is none, and says so.
      const job = rows("employers")[row ?? 0];
      if (!job) return;
      const answer = value === true || value === false ? value : null;
      for (const k of DOT_ANSWERS) job[k] = answer;
      job.dot_not_sure = value === NOT_SURE;
      return;
    }
    const [key, at, column] = draftPath(path, row);
    if (column === undefined) doc()[key as string] = value;
    else {
      const target = rows(key as string)[at as number];
      if (target) target[column as string] = value;
    }
    for (const screen of dependants(path)) {
      if (value === screen.when!.is) continue;
      for (const f of screen.fields) write(f.fact.path, emptyOf(read(f.fact.path, row)), row);
    }
    // SCREEN-MAP 2.11a: a job where the driver drove is filed as "Driver"; the title is asked only otherwise.
    // And a "Driver" WE wrote goes when the answer does, so the title is asked, never left as ours.
    const POSITION = "application.employers[].position_held";
    if (path === DROVE && value === true) write(POSITION, DRIVER_POSITION, row);
    else if (path === DROVE && read(POSITION, row) === DRIVER_POSITION) write(POSITION, "", row);
  }

  return {
    read,
    write,
    copy: (path, screen) => {
      const found = (screen && screenCopy()[screen]?.[path]) ?? fieldCopy()[path];
      if (!found) throw new Error(`No words for ${path} on Part 2's page — add it to draftFields.ts.`);
      return found;
    },
    error: (path, row) => {
      // A gate's own refusal ("list every accident, or say there were none") is reported at the LIST; a
      // whole list's (one other name too long) under the list.
      const gate = gateOf(path);
      const own = pathAt(path, row);
      return issues().find((i) => (gate !== undefined && i.path.length === 1 && i.path[0] === gate) || pathUnder(i.path, own))?.say;
    },
    // A gate takes the list's id: that is where the send summary's cross-field entry moves focus.
    id: (path, row) => {
      const gate = gateOf(path);
      return fieldId(gate ? [gate] : pathAt(path, row));
    },
    path: pathAt,
    settle: () => settleEmploymentGaps(draft(), v2AsOf()),
    /**
     * A job nothing was typed in is not a job (`employerIsBlank`, §9 P8): a new draft starts with one
     * blank row, and the gate reads a row as Yes. So opening the task drops them, and "have you had a
     * job?" is asked with nothing chosen — as every question is since F1 part 2.
     */
    open: (task) => {
      if (task !== "employment") return;
      const jobs = draft().employers;
      if (jobs.some(employerIsBlank)) draft().employers = jobs.filter((e) => !employerIsBlank(e));
    },
    // One address, by the server's own row schema, with the paths the page's own (`AddressDrawer`'s rule).
    rowIssues: (list, row) => {
      // One gap, by the filing's own rule. Asked here because the task's check reaches the filing's rules
      // only once the contract's are satisfied, and a gap's screen comes before the task can be.
      if (list === "employment_gaps") {
        const from = String(rows(list)[row]?.from ?? "");
        return v2FilingIssues(draft(), v2AsOf()).filter((i) => i.path[0] === "employment_gaps" && i.path[1] === from);
      }
      // One job, as its own Save judged it (`checkEmployer`): the row schema, then a v2 filing's rules for it.
      if (list === "employers") {
        const job = rows(list)[row] as unknown as DraftEmployer | undefined;
        return job ? checkEmployer(job, row, v2AsOf()) : [];
      }
      const address = list === "addresses" ? (rows(list)[row] as unknown as DraftAddress | undefined) : undefined;
      if (!address) return [];
      const candidate = toAddressPayload(address);
      const parsed = applicationAddressSchema.safeParse(candidate);
      return parsed.success ? [] : parsed.error.issues.map((issue) => {
        const path = ["addresses", row, ...(issue.path as (string | number)[])];
        return {
          path, key: "addresses", message: issue.message, label: describeField(path),
          say: messageFor({ ...issue, path }, valueAt(candidate, issue.path as (string | number)[])),
          fieldId: fieldId(path), section: "addresses" as const,
        };
      });
    },
    rowKind: (list, row): RowKind =>
      list === "addresses" && currentAddressRow(rows(list) as unknown as DraftAddress[]) === row ? "current" : "earlier",
  };
}

/** A new row for a list the walk loops over — the same blank row the section component added. */
export function newRow(list: string, rows: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  const make = NEW_ROW[list];
  if (!make) throw new Error(`No blank row for ${list} — add it to draftFields.ts.`);
  return make(rows);
}
