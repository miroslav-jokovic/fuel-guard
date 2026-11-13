import { z } from "zod";
import { APPLICANT_FACTS, type ApplicantFact, type FactPath } from "./applicantFacts.js";
import { applicantIntakeLicenceSchema, applicantIntakeSchema } from "./applicantScreeningContract.js";
import { PART_ONE_SCREENS, type PartOneScreen } from "./applicationScreens.js";
import type { ApplicationSection } from "./applicationSections.js";
import {
  WIZARD_SCREEN_IDS,
  type FactAsk,
  type WizardCondition,
  type WizardScreenId,
} from "./applicantWizardScreens.js";

/**
 * Part 2's tasks whose screens are generated (F4 PR 1b, plan §7 2026-11-13) — each joins with its PR.
 * A task not here is still its hand-written section component. `questions` has no catalogue screen: every
 * one of its screens is a question of the served definition (`askedByDefinition`).
 */
export const GENERATED_TASKS = ["identity", "safety", "questions"] as const satisfies readonly ApplicationSection[];
export type GeneratedTask = (typeof GENERATED_TASKS)[number];
export const isGeneratedTask = (section: string): section is GeneratedTask =>
  (GENERATED_TASKS as readonly string[]).includes(section);

/**
 * The wizard, generated from the fact catalogue (APPLICATION-SCREEN-MAP.md §7, F4 PR 1).
 *
 * A screen is the facts whose `ask` names it, in catalogue order: one fact is a single-question
 * screen (D-AM2), several are one fact typed together (D-AM3: an address, a licence card). The page
 * renders whatever this returns (`WizardScreen.vue`), so a fact given an `ask` is on the form on the
 * same merge, with no screen component written for it — and a screen's contents cannot be stated
 * twice, because they are stated nowhere but on the facts.
 */

export interface WizardField {
  readonly fact: ApplicantFact;
  readonly ask: FactAsk;
}

export interface WizardScreen {
  readonly id: WizardScreenId;
  /** Stage 1 is Part 1's pages; Stage 2 is Part 2's tasks (`applicantWizardScreens.ts`'s header). */
  readonly stage: 1 | 2;
  /** The page (Stage 1) or task (Stage 2) that saves it. */
  readonly page: PartOneScreen | GeneratedTask;
  /** SCREEN-MAP's "1Q" (one question) or "G" (one fact typed together). */
  readonly kind: "question" | "group";
  readonly fields: readonly WizardField[];
  /** Shown only when (the "IF" column). Every field of a screen asks under the same condition. */
  readonly when?: WizardCondition;
  /**
   * The list whose row this screen asks about — set when every field is one list's column
   * (`application.accidents[].nature` → `accidents`). DERIVED, never stated: a screen of row columns
   * is a loop screen by what it asks, so the walk repeats it per row and ends the list with "Any other?".
   */
  readonly list?: string;
  /** The list this screen's yes/no opens or closes (`FactAsk.gate`). */
  readonly gate?: string;
}

const pageOf = (id: WizardScreenId): PartOneScreen | GeneratedTask =>
  id.slice(0, id.indexOf(".")) as PartOneScreen | GeneratedTask;

/** `application.accidents[].nature` → `accidents`; undefined for anything that is not a row's column. */
export const rowListOf = (path: FactPath): string | undefined => /^application\.([a-z_]+)\[\]\./.exec(path)?.[1];

/** Every screen, in walking order. */
export const WIZARD_SCREENS: readonly WizardScreen[] = WIZARD_SCREEN_IDS.map((id) => {
  const fields = APPLICANT_FACTS.flatMap((fact) =>
    (fact.ask ?? []).filter((a) => a.screen === id).map((ask) => ({ fact, ask })));
  const when = fields[0]?.ask.when;
  const gate = fields[0]?.ask.gate;
  const lists = new Set(fields.map((f) => rowListOf(f.fact.path)));
  const list = lists.size === 1 ? [...lists][0] : undefined;
  const page = pageOf(id);
  return {
    id,
    stage: isGeneratedTask(page) ? 2 : 1,
    page,
    kind: fields.length > 1 ? "group" : "question",
    fields,
    ...(when ? { when } : {}),
    ...(list ? { list } : {}),
    ...(gate ? { gate } : {}),
  } satisfies WizardScreen;
});

/** A page's screens, in order. Empty for a page the wizard does not generate (the photographs, the rights). */
export const wizardScreensOf = (page: PartOneScreen): readonly WizardScreen[] =>
  WIZARD_SCREENS.filter((s) => s.stage === 1 && s.page === page);

/** A Part 2 task's screens, in order (F4 PR 1b). Empty for a task still hand-written. */
export const wizardTaskScreens = (task: ApplicationSection): readonly WizardScreen[] =>
  WIZARD_SCREENS.filter((s) => s.stage === 2 && s.page === task);

/** Is the screen asked, given the answers so far? `answer` reads a fact's current value by path. */
export const wizardScreenShown = (screen: WizardScreen, answer: (path: FactPath) => unknown): boolean =>
  !screen.when || answer(screen.when.fact) === screen.when.is;

/**
 * Part 1's facts that no generated screen asks yet, each with where it IS asked. The catalogue test
 * holds every Part 1 fact to an `ask` or a line here, so a new Part 1 fact cannot reach the contract
 * with no screen; this list only shrinks (F4 PR 1b takes the loop's two).
 */
export const ASKED_BY_HAND: Readonly<Record<FactPath, string>> = {
  "intake.licences[].agency": "asked per other licence in the other-licences loop (PartOneOtherLicences) until F4 PR 1b generates the loops",
  "intake.licences[].kind": "asked per other licence in the other-licences loop (PartOneOtherLicences) until F4 PR 1b generates the loops",
  "intake.medical_card_pending": "the medical-card photo screen's own \"I don't have one yet\" (PartOnePhoto) — a photo's alternative, not a question",
};

/**
 * Facts a generated task owns (`APPLICATION_SECTION_KEYS`) that its walk does not ask, each with where
 * they ARE asked. The catalogue test holds every fact of a generated task to an `ask` or a line here.
 */
export const TASK_FACTS_ASKED_ELSEWHERE: Readonly<Record<FactPath, string>> = {
  "application.prior_failed_pre_employment_test":
    "asked once, in Part 1 (D-AW13, SCREEN-MAP 1.10); a v2 filing takes Part 1's answer, and the legacy wizard asks its own",
  "application.date_of_birth":
    "asked in Part 1 (SCREEN-MAP 1.3); \"About you\" shows Part 1's answer on its last screen, with \"Something wrong? Tell us\"",
  "application.phone":
    "asked in Part 1 (SCREEN-MAP 1.2); \"About you\" shows Part 1's answer on its last screen, with \"Something wrong? Tell us\"",
};

/**
 * The carrier's questions are asked by the DEFINITION served with the link, not by the catalogue (D-APP12):
 * which questions, in which version and on which task is the definition's to say (`questionsForScreen`),
 * and the carrier's own are stamped per invitation (D-CQ2). So the walk asks each asked question on a
 * screen of its own (SCREEN-MAP 2.2–2.4, 2.22–2.27), and the catalogue's entries for them only name them.
 */
export const askedByDefinition = (path: FactPath): boolean =>
  path.startsWith("application.questionnaire_answers.") || path === "application.carrier_answers";

/** Part 1's own pages the wizard may cut a screen from — what an id's prefix must be. */
export const isWizardPage = (page: string): page is PartOneScreen => (PART_ONE_SCREENS as readonly string[]).includes(page);

// ── a choice's answers, read from the contract ──────────────────────────────────────────────────

/** Past the wrappers that do not change which values are allowed. */
function bare(schema: z.ZodType): z.ZodType {
  let at: z.ZodType = schema;
  while (at instanceof z.ZodOptional || at instanceof z.ZodNullable || at instanceof z.ZodDefault) {
    at = at.unwrap() as z.ZodType;
  }
  return at;
}

/**
 * The values a choice fact may take, in the contract's own order — `intake.cdl_class` → the
 * contract's `CDL_CLASSES`. Read from the schema the server validates with, so a class added there
 * is a button on the screen on the same merge (deriving beats restating). Undefined for a path that
 * is not a Part 1 choice.
 */
export function factChoices(path: FactPath): readonly string[] | undefined {
  const m = /^intake\.(licences\[\]\.)?([a-z_0-9]+)(\[\])?$/.exec(path);
  if (!m) return undefined;
  const shape = (m[1] ? applicantIntakeLicenceSchema : applicantIntakeSchema).shape as Record<string, z.ZodType>;
  const field = shape[m[2]!];
  if (!field) return undefined;
  let at = bare(field);
  if (m[3]) {
    if (!(at instanceof z.ZodArray)) return undefined;
    at = bare(at.element as z.ZodType);
  }
  return at instanceof z.ZodEnum ? (at.options as readonly string[]) : undefined;
}
