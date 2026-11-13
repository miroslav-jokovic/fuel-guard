import { rowListOf, WIZARD_SCREENS, type FactPath } from "@silvicom/shared";
import { emptyAccident, emptyViolation, type ApplicationDraft } from "@/features/apply/draft";
import { fieldId, type FieldPath } from "@/features/apply/fieldLabels";
import { APPLY_COPY } from "@/features/apply/strings";
import type { SectionIssue } from "@/features/apply/useApplicationWizard";
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

/** A list's blank row, as the section components made it — so a new row is the same row either way. */
const NEW_ROW: Readonly<Record<string, () => Record<string, unknown>>> = {
  accidents: () => ({ ...emptyAccident() }),
  violations: () => ({ ...emptyViolation() }),
};

/** The draft path of a fact on a row (or the whole fact, off a row) — the path issues are reported at. */
export function draftPath(path: FactPath, row?: number): FieldPath {
  const list = rowListOf(path);
  if (list !== undefined) return [list, row ?? 0, path.slice(`application.${list}[].`.length)];
  return [path.slice("application.".length)];
}

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
  return {
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

/** The paths Part 2's page can answer — what the binding test holds the catalogue's Stage 2 screens to. */
export const DRAFT_BOUND_PATHS = (): FactPath[] => Object.keys(fieldCopy());

type Rows = Record<string, unknown>[];

/** Part 2's draft, as the generated screens read and write it. */
export function draftBinding(draft: () => ApplicationDraft, issues: () => readonly SectionIssue[]): WizardBinding {
  const doc = (): Record<string, unknown> => draft() as unknown as Record<string, unknown>;
  const rows = (list: string): Rows => (doc()[list] as Rows | undefined) ?? [];

  function read(path: FactPath, row?: number): unknown {
    const gate = gateOf(path);
    if (gate !== undefined) {
      // Tri-state from what storage holds: declared none is No, a row is Yes, neither is unanswered.
      if (doc()[path.slice("application.".length)] === true) return false;
      return rows(gate).length > 0 ? true : null;
    }
    const [key, at, column] = draftPath(path, row);
    if (column === undefined) return doc()[key as string];
    return rows(key as string)[at as number]?.[column as string];
  }

  function write(path: FactPath, value: unknown, row?: number): void {
    const gate = gateOf(path);
    if (gate !== undefined) {
      const yes = value === true;
      doc()[path.slice("application.".length)] = value === false;
      if (value === false) doc()[gate] = [];
      else if (yes && rows(gate).length === 0) doc()[gate] = [NEW_ROW[gate]!()];
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
  }

  return {
    read,
    write,
    copy: (path) => {
      const found = fieldCopy()[path];
      if (!found) throw new Error(`No words for ${path} on Part 2's page — add it to draftFields.ts.`);
      return found;
    },
    error: (path, row) => {
      // A gate's own refusal ("list every accident, or say there were none") is reported at the LIST.
      const gate = gateOf(path);
      const ids = new Set([fieldId(draftPath(path, row)), ...(gate ? [fieldId([gate])] : [])]);
      return issues().find((i) => ids.has(i.fieldId))?.say;
    },
    // A gate takes the list's id: that is where the send summary's cross-field entry moves focus.
    id: (path, row) => {
      const gate = gateOf(path);
      return fieldId(gate ? [gate] : draftPath(path, row));
    },
  };
}

/** A new row for a list the walk loops over — the same blank row the section component added. */
export function newRow(list: string): Record<string, unknown> {
  const make = NEW_ROW[list];
  if (!make) throw new Error(`No blank row for ${list} — add it to draftFields.ts.`);
  return make();
}
