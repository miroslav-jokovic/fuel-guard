import { z } from "zod";
import { APPLICANT_FACTS, type ApplicantFact, type FactPath } from "./applicantFacts.js";
import { applicantIntakeLicenceSchema, applicantIntakeSchema } from "./applicantScreeningContract.js";
import { PART_ONE_SCREENS, type PartOneScreen } from "./applicationScreens.js";
import {
  WIZARD_SCREEN_IDS,
  type FactAsk,
  type WizardCondition,
  type WizardScreenId,
} from "./applicantWizardScreens.js";

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
  /** The page that saves it (`applicantWizardScreens.ts`'s header). */
  readonly page: PartOneScreen;
  /** SCREEN-MAP's "1Q" (one question) or "G" (one fact typed together). */
  readonly kind: "question" | "group";
  readonly fields: readonly WizardField[];
  /** Shown only when (the "IF" column). Every field of a screen asks under the same condition. */
  readonly when?: WizardCondition;
}

const pageOf = (id: WizardScreenId): PartOneScreen => id.slice(0, id.indexOf(".")) as PartOneScreen;

/** Every screen, in walking order. */
export const WIZARD_SCREENS: readonly WizardScreen[] = WIZARD_SCREEN_IDS.map((id) => {
  const fields = APPLICANT_FACTS.flatMap((fact) =>
    (fact.ask ?? []).filter((a) => a.screen === id).map((ask) => ({ fact, ask })));
  const when = fields[0]?.ask.when;
  return { id, page: pageOf(id), kind: fields.length > 1 ? "group" : "question", fields, ...(when ? { when } : {}) };
});

/** A page's screens, in order. Empty for a page the wizard does not generate (the photographs, the rights). */
export const wizardScreensOf = (page: PartOneScreen): readonly WizardScreen[] =>
  WIZARD_SCREENS.filter((s) => s.page === page);

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
