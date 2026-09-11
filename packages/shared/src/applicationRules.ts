import type { DriverApplicationFields } from "./applicationContract.js";

/**
 * The rules that no single field can express, in one list rather than in a `.refine()` chain.
 *
 * A3 needs them twice — once over the whole document at submit, once over the one section a driver
 * is looking at — and two copies of "an empty list is only an answer if you SAID it was empty" is
 * two copies that drift. `check` therefore takes a PARTIAL: mid-form, most of the document does not
 * exist yet, and a rule whose fields are absent must not fire.
 *
 * Every one of them exists for the same reason (H8's lesson, restated in 0208's header): an empty
 * array is an ANSWER, not an omission, and only the driver can turn one into the other.
 */
export interface ApplicationCrossFieldRule {
  /** The field the message attaches to — and the field that decides which section owns the rule. */
  path: keyof DriverApplicationFields;
  message: string;
  check: (v: Partial<DriverApplicationFields>) => boolean;
}

export const APPLICATION_CROSS_FIELD_RULES: readonly ApplicationCrossFieldRule[] = [
  {
    path: "accidents",
    message: "List every accident in the last 3 years, or confirm there were none",
    check: (v) => v.accidents === undefined || v.accidents.length > 0 || v.declares_no_accidents === true,
  },
  {
    path: "violations",
    message: "List every violation in the last 3 years, or confirm there were none",
    check: (v) => v.violations === undefined || v.violations.length > 0 || v.declares_no_violations === true,
  },
  {
    path: "employers",
    message: "List your employers, or confirm you have not been employed",
    check: (v) => v.employers === undefined || v.employers.length > 0 || v.declares_no_employment === true,
  },
  {
    /**
     * §391.21(b)(6) is mandatory content of the application form, and until now this schema let it be
     * entirely blank — `experience` was nullish and there was nothing else. Either half of the
     * paragraph's sentence satisfies it, and a driver can always answer one: they can name the
     * equipment they have driven even if they will not write a paragraph about it.
     */
    path: "equipment_experience",
    message: "Describe your driving experience, or list the equipment you have driven",
    check: (v) =>
      v.equipment_experience === undefined
      || v.equipment_experience.length > 0
      || Boolean(v.experience?.trim()),
  },
  {
    path: "licence_denial_detail",
    message: "Describe the denial, revocation or suspension",
    check: (v) => v.licence_ever_denied !== true || Boolean(v.licence_denial_detail?.trim()),
  },
];
