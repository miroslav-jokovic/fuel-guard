import { APPLY_COPY } from "./strings";

/**
 * What a driver is told went wrong, and where (APPLY-EXPERIENCE-PLAN D-AX3).
 *
 * ── THE DEFECT THIS REPLACES ──────────────────────────────────────────────────────────────────
 * `ApplyPage` rendered its validation summary as `{{ issue.key }} — {{ issue.message }}`, and
 * `issue.key` is the Zod path, which is the contract key. So a driver on a phone read
 * **`equipment_experience`**, **`licence_denial_detail`**, **`declares_no_accidents`** — column names
 * from a database they will never see — and then, because the message came straight from Zod, read
 * *"Too small: expected string to have >=1 characters"* underneath.
 *
 * Two different failures with one cause: the form was showing a driver the machine's vocabulary for
 * its own document.
 *
 * ── WHY THE LABELS POINT AT `APPLY_COPY` RATHER THAN REPEATING IT ─────────────────────────────
 * An error has to name the field using the SAME WORDS that are printed above the box. If the screen
 * says "Reason for leaving" and the error says "Departure reason", the driver has two fields to look
 * for and finds neither. Every entry below is therefore a reference into the copy the field itself
 * renders, never a second copy of the string — so a copy change moves both at once, and the pair
 * cannot drift.
 *
 * ⚠ Where no reference exists, the key is one no control renders (`certified`, `questionnaire_*`).
 * Those still need a label, because `fieldLabels.test.ts` walks the contract and fails on any key
 * without one — a key with no home is exactly how `equipment_experience` reached a screen.
 */

/** A contract path as Zod reports it: `["addresses", 0, "city"]`, or `["cdl_number"]`. */
export type FieldPath = readonly (string | number)[];

/**
 * ⚠ Built on every call, never at module load (C4): the words come from `APPLY_COPY`, which answers in
 * the page's language, and a map filled once at import would be English for ever. The cost is a few
 * dozen property reads per issue listed, which is nothing.
 */
const topLabels = (): Record<string, string> => {
  const { identity, licence, employment, safety, certify, fields } = APPLY_COPY;
  /** Every top-level contract key, in the words the screen that owns it uses. */
  return {
  first_name: identity.first_name,
  middle_name: identity.middle_name,
  last_name: identity.last_name,
  date_of_birth: identity.date_of_birth,
  other_names: identity.otherNames,
  email: identity.email,
  phone: identity.phone,
  addresses: fields.addresses,
  cdl_number: licence.number,
  cdl_state: licence.state,
  cdl_class: licence.class,
  cdl_expires_at: licence.expires,
  additional_licences: licence.othersHeading,
  experience: employment.experience,
  equipment_experience: employment.equipmentHeading,
  accidents: safety.accidentsHeading,
  declares_no_accidents: safety.noAccidents,
  violations: safety.violationsHeading,
  declares_no_violations: safety.noViolations,
  // The question since C3c2c1 — it is what the driver answers, and what a refusal names.
  licence_ever_denied: safety.deniedQuestion,
  licence_denial_detail: safety.denialDetail,
  prior_failed_pre_employment_test: safety.priorTestHeading,
  employers: fields.employers,
  declares_no_employment: employment.none,
  // AW1 (APPLICATION-FLOW-V2): the applicant's word for each stretch of the three years with no job.
  employment_gaps: fields.gaps,
  // Neither of these is a control. They are the questionnaire's two contract fields, written by the
  // questions screen as a pair, and a driver can no more "fix" one than they can fix a timestamp.
  questionnaire_version: fields.questionnaire,
  questionnaire_answers: fields.questionnaire,
  certified: certify.heading,
  signed_name: certify.signedName,
  };
};

/**
 * The collections, and what one of their rows is called.
 *
 * `noun` is singular and is numbered from 1 when it is shown — "Address 2", "Employer 1". A driver
 * counting down a screen counts from one, and an error naming "Address 0" would send them to the
 * wrong card.
 */
const rowLabels = (): Record<string, { noun: string; columns: Record<string, string> }> => {
  const { addresses, licence, employment, safety, fields } = APPLY_COPY;
  const noun = fields.nouns;
  return {
  other_names: { noun: noun.other_names, columns: {} },
  addresses: {
    noun: noun.addresses,
    columns: {
      line1: addresses.line1,
      line2: addresses.line2,
      city: addresses.city,
      state: addresses.state,
      postal_code: addresses.postal_code,
      from: addresses.from,
      to: addresses.to,
    },
  },
  additional_licences: {
    noun: noun.additional_licences,
    columns: {
      issuing_authority: licence.issuingAuthority,
      number: licence.otherNumber,
      expires_at: licence.expires,
      kind: licence.otherKind,
    },
  },
  employers: {
    noun: noun.employers,
    columns: {
      // Not a control: the stable id the form mints for an employer (AW1), which the office's phone
      // verification is filed under. A driver sees it only if it is missing, as "this employer".
      key: fields.employerRecord,
      employer_name: employment.employer,
      usdot_number: employment.usdot,
      address_line1: employment.address,
      city: employment.city,
      state: employment.state,
      phone: employment.phone,
      email: employment.email,
      position_held: employment.position,
      started_on: employment.from,
      ended_on: employment.to,
      operated_cmv: employment.operatedCmv,
      dot_regulated: employment.dotRegulated,
      reason_for_leaving: employment.reason,
      subject_to_fmcsr: employment.subjectToFmcsr,
      safety_sensitive: employment.safetySensitive,
    },
  },
  employment_gaps: {
    noun: noun.employment_gaps,
    columns: { from: fields.gapFrom, to: fields.gapTo, explanation: fields.gapWhat },
  },
  equipment_experience: {
    noun: noun.equipment_experience,
    columns: {
      equipment_class: employment.equipmentClass,
      equipment_type: employment.equipmentType,
      from: employment.equipmentFrom,
      to: employment.equipmentTo,
      approx_miles: employment.equipmentMiles,
    },
  },
  accidents: {
    noun: noun.accidents,
    columns: {
      occurred_on: safety.accidentDate,
      nature: safety.accidentNature,
      fatalities: safety.fatalities,
      injuries: safety.injuries,
      hazmat_spill: safety.hazmatSpill,
    },
  },
  violations: {
    noun: noun.violations,
    columns: {
      occurred_on: safety.violationDate,
      offence: safety.offence,
      state: safety.violationState,
      penalty: safety.penalty,
    },
  },
  };
};

/** Exported for the totality test, which is the only reason either map is not module-private. */
export const FIELD_LABEL_KEYS = {
  get TOP(): Record<string, string> {
    return topLabels();
  },
  get ROWS(): Record<string, { noun: string; columns: Record<string, string> }> {
    return rowLabels();
  },
};

/**
 * The field, named the way the screen names it.
 *
 * `["cdl_number"]` → "Licence number"
 * `["addresses", 1, "city"]` → "Address 2 · City"
 * `["other_names", 0]` → "Name 1"
 *
 * Falls back to the raw segment only for a path no contract produces — an unreachable branch that
 * returns something rather than throwing, because a validation summary that crashes is strictly
 * worse than one that is briefly ugly.
 */
export function describeField(path: FieldPath): string {
  const [head, index, column] = path;
  const key = String(head ?? "");
  const row = rowLabels()[key];

  if (row && typeof index === "number") {
    const where = `${row.noun} ${index + 1}`;
    if (column === undefined) return where;
    return `${where} · ${row.columns[String(column)] ?? String(column)}`;
  }
  // §9 P5 (Q-AX7): an employer named by its key rather than its position. The key is a reference, not
  // words, so the row is named by its noun alone; a screen that holds the row names it better.
  if (row && typeof index === "string") {
    if (column === undefined) return row.noun;
    return `${row.noun} · ${row.columns[String(column)] ?? String(column)}`;
  }
  return topLabels()[key] ?? key;
}

/**
 * The DOM id of the control holding this path.
 *
 * ⚠ It is a CONVENTION shared by two places that never call each other: the field components set it
 * through `AppFormField`'s `id` prop, and the wizard reads it back with `getElementById` to move
 * focus. That is why it is a function in one file rather than a string template in six — the day the
 * two disagree, focus silently stops working and nothing fails.
 */
export const fieldId = (path: FieldPath): string => ["apply", ...path].join("-");

/**
 * ── AND WHAT WENT WRONG, IN A SENTENCE A DRIVER CAN ACT ON ────────────────────────────────────
 *
 * The messages below replace Zod's, which were reaching the screen verbatim:
 *
 *   Too small: expected string to have >=1 characters
 *   Too big: expected string to have <=100 characters
 *   Invalid input: expected true
 *
 * Those are correct, and they are addressed to whoever wrote the schema. ⚠ **They are not
 * translated key by key** — that would be a second copy of the contract, drifting the day a
 * `.min()` moves. They are derived from the issue's CODE and the value that produced it, which is
 * why an empty box and a two-character one get different sentences from the same rule.
 *
 * A schema-authored message is kept as it stands: `code: "custom"` is where
 * `APPLICATION_CROSS_FIELD_RULES` and the date-of-birth refinement live, and those were written for
 * this reader already ("List every accident in the last 3 years, or confirm there were none").
 */

/** One issue, in the shape both Zod and the cross-field rules produce. */
export interface FieldIssueLike {
  code?: string;
  message: string;
  format?: string;
  path: FieldPath;
}

/**
 * The handful of places a generated sentence is not good enough, keyed by top-level contract key.
 *
 * ⚠ Kept to the cases where the generic reads as a non-answer. `certified` is the whole of it today:
 * the control is a tick box, the value is `false` rather than empty, and "This is needed" beside
 * "Your certification" tells a driver nothing about what to do with their thumb.
 */
const overrides = (): Record<string, string> => ({
  certified: APPLY_COPY.fields.certifyOverride,
});

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function messageFor(issue: FieldIssueLike, value: unknown): string {
  // Written for this reader already — the cross-field rules and the date-of-birth refinement.
  if (issue.code === "custom") return issue.message;

  const override = overrides()[String(issue.path[0] ?? "")];
  if (override) return override;

  const words = APPLY_COPY.fields;
  if (Array.isArray(value) && issue.code === "too_small") return words.addOne;
  if (isEmpty(value)) return words.needed;

  switch (issue.code) {
    case "invalid_format":
      if (issue.format === "email") return words.notEmail;
      /**
       * ⚠ Every non-email format rule in this contract is a date or a month regex, and the schema's
       * own message for those is "Expected a date as YYYY-MM-DD" — which was written for an API
       * caller and is now false besides: since X1 these are all pickers, and a driver never types
       * that shape. The message is NOT corrected in `packages/shared`, deliberately: the same string
       * is on twenty rules across seven contracts, most of them staff-facing API surfaces where it
       * is still the right thing to say, and rewriting all of them is a larger change than this one.
       *
       * So the branch is defensive rather than routine — from the UI these fields can only be
       * well-formed or empty, and empty is caught above.
       */
      return words.fromCalendar;
    case "too_big":
      return words.tooLong;
    case "too_small":
      return words.tooShort;
    case "invalid_type":
    case "invalid_value":
      return words.needed;
    default:
      // ⚠ Deliberately swallows the schema's words rather than risking Zod's reaching a driver. A
      // vague sentence is a poor outcome; "expected string to have >=1 characters" is a worse one,
      // and `fieldLabels.test.ts` fails the build if anything in the first list ever gets through.
      return words.check;
  }
}

/** The value at a contract path, for `messageFor` — undefined when the path does not resolve. */
export function valueAt(root: unknown, path: FieldPath): unknown {
  let at: unknown = root;
  for (const step of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[step as string | number];
  }
  return at;
}

/**
 * An office correction, as the applicant record's activity list says it (HIRING-WORKFLOW-AUDIT-2026-10-31
 * §9 P10): "filled in “Street address” for ABC Trucking". Here, beside the labels, because the field
 * must be named in the words the applicant's own screen prints — the activity list is in
 * `features/recruitment`, which may not import this feature, so the page hands it this function.
 */
export function describeOfficeEdit(edit: {
  path: FieldPath;
  change: "filled" | "changed" | "cleared" | "added" | "removed";
  employer: string | null;
}): string {
  const at = edit.employer ? ` for ${edit.employer}` : "";
  if (edit.change === "added") return edit.employer ? `added a job: ${edit.employer}` : "added a job";
  if (edit.change === "removed") return edit.employer ? `removed a job: ${edit.employer}` : "removed a job";
  const [head, , column] = edit.path;
  // A job's own answer is named by its column alone — the employer's name says which job.
  const label =
    edit.employer && column !== undefined
      ? (rowLabels()[String(head)]?.columns[String(column)] ?? describeField(edit.path))
      : describeField(edit.path);
  const verb = edit.change === "filled" ? "filled in" : edit.change === "cleared" ? "cleared" : "changed";
  return `${verb} “${label}”${at}`;
}
