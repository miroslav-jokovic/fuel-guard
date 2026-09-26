import {
  questionnaireForApplicant,
  questionnaireRef,
  toJurisdictionCode,
  type DriverApplication,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
import {
  emptyDraft,
  type ApplicationDraft,
  type DraftAccident,
  type DraftAddress,
  type DraftEmployer,
  type DraftEquipment,
  type DraftLicence,
  type DraftViolation,
} from "./draftShape";

// The form's working shape — the `Draft*` types, `ApplicationDraft` and the `empty*` factories —
// lives in `draftShape.ts` since C1 (2026-09-26); re-exported so no import path changed.
export * from "./draftShape";

/** One blank row for a `table` question — every column empty, which is what "not answered" is. */
export const emptyQuestionRow = (q: QuestionnaireQuestion): Record<string, unknown> =>
  Object.fromEntries((q.columns ?? []).map((c) => [c.id, c.kind === "boolean" ? false : ""]));

/**
 * The answers, with what nobody answered taken out.
 *
 * Blank strings become absent rather than `""` — the same rule the rest of this file follows, because
 * the schema's nullish fields mean "not answered" and an empty string is an answer of nothing. Table
 * rows the driver added and left completely blank are dropped, exactly as an accidental "Add another"
 * click is dropped from addresses, employers and licences.
 */
export function cleanQuestionnaire(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value === "string") {
      if (value.trim() !== "") out[key] = value.trim();
    } else if (Array.isArray(value)) {
      const rows = value.filter((row) =>
        row && typeof row === "object"
        && Object.values(row as Record<string, unknown>).some(
          (v) => (typeof v === "string" && v.trim() !== "") || typeof v === "number" || v === true,
        ));
      if (rows.length > 0) out[key] = rows;
    } else if (value !== null && value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const num = (v: string): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Draft → the shape the contract validates.
 *
 * Empty strings become `null`, never `""`: the schema's `.nullish()` fields mean "not answered", and
 * an empty string is an answer of nothing. Rows the applicant added and left completely blank are
 * dropped — an accidental "Add another" click is not a declaration.
 */
/**
 * One employer, as the contract wants it.
 *
 * ⚠ Lifted out of `toApplication` so that ONE row can be validated on its own — X5 asks each job for
 * its fifteen answers in a drawer of its own and checks it when the driver saves, rather than
 * collecting six jobs and reporting ninety controls' worth of problems at once. A second mapper for
 * that would be a second opinion about what a row is, and the two would drift on the next field.
 */
export function toEmployerPayload(e: DraftEmployer): Record<string, unknown> {
  return {
    employer_name: e.employer_name.trim(),
    usdot_number: text(e.usdot_number),
    address_line1: text(e.address_line1),
    city: text(e.city),
    state: text(e.state),
    phone: text(e.phone),
    email: text(e.email),
    position_held: text(e.position_held),
    started_on: e.started_on,
    ended_on: text(e.ended_on),
    operated_cmv: e.operated_cmv,
    dot_regulated: e.dot_regulated,
    reason_for_leaving: text(e.reason_for_leaving),
    subject_to_fmcsr: e.subject_to_fmcsr,
    safety_sensitive: e.safety_sensitive,
  };
}

export function toApplication(draft: ApplicationDraft): unknown {
  return {
    first_name: draft.first_name.trim(),
    middle_name: text(draft.middle_name),
    last_name: draft.last_name.trim(),
    // Blank rows dropped, like every other repeated field on this form.
    other_names: draft.other_names.map((n) => n.trim()).filter((n) => n !== ""),
    date_of_birth: draft.date_of_birth,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    addresses: draft.addresses
      .filter((a) => a.line1.trim() || a.city.trim())
      .map((a) => ({
        line1: a.line1.trim(), line2: text(a.line2), city: a.city.trim(),
        state: a.state.trim(), postal_code: a.postal_code.trim(),
        from: a.from, to: text(a.to),
      })),
    cdl_number: draft.cdl_number.trim(),
    cdl_state: draft.cdl_state.trim().toUpperCase(),
    cdl_class: text(draft.cdl_class),
    cdl_expires_at: draft.cdl_expires_at,
    // §391.21(b)(5)'s "each": rows the applicant added and left blank are dropped, the same rule the
    // addresses and employers follow — an accidental "Add another" click is not a declaration.
    additional_licences: draft.additional_licences
      .filter((l) => l.number.trim() || l.issuing_authority.trim())
      .map((l) => ({
        issuing_authority: l.issuing_authority.trim(),
        number: l.number.trim(),
        expires_at: l.expires_at,
        kind: text(l.kind),
      })),
    experience: text(draft.experience),
    // §391.21(b)(6)'s equipment. A row with no class chosen is an accidental "Add another", not an
    // answer — the same rule the addresses, employers and licences follow.
    equipment_experience: draft.equipment_experience
      .filter((e) => e.equipment_class !== "" && e.from.trim() !== "")
      .map((e) => ({
        equipment_class: e.equipment_class,
        equipment_type: text(e.equipment_type),
        from: e.from,
        to: text(e.to),
        approx_miles: e.approx_miles.trim() === "" ? null : num(e.approx_miles),
      })),
    accidents: draft.accidents
      .filter((a) => a.occurred_on || a.nature.trim())
      .map((a) => ({
        occurred_on: a.occurred_on, nature: a.nature.trim(),
        fatalities: num(a.fatalities), injuries: num(a.injuries), hazmat_spill: a.hazmat_spill,
      })),
    declares_no_accidents: draft.declares_no_accidents,
    violations: draft.violations
      .filter((v) => v.occurred_on || v.offence.trim())
      .map((v) => ({
        occurred_on: v.occurred_on, offence: v.offence.trim(),
        state: text(v.state), penalty: text(v.penalty),
      })),
    declares_no_violations: draft.declares_no_violations,
    licence_ever_denied: draft.licence_ever_denied,
    licence_denial_detail: text(draft.licence_denial_detail),
    prior_failed_pre_employment_test: draft.prior_failed_pre_employment_test,
    employers: draft.employers.filter((e) => e.employer_name.trim()).map(toEmployerPayload),
    declares_no_employment: draft.declares_no_employment,
    /**
     * The carrier's questions (A9). The version is stamped only when something was actually answered:
     * an application nobody answered a carrier question on should not claim to have been filed
     * against a questionnaire. The client bundles the definition it displayed, so the ref and the
     * answers cannot disagree within a session.
     */
    ...questionnaireFields(draft),
    certified: draft.certified,
    signed_name: draft.signed_name.trim(),
  } satisfies Record<keyof DriverApplication | string, unknown>;
}

function questionnaireFields(draft: ApplicationDraft): Record<string, unknown> {
  const answers = cleanQuestionnaire(draft.questionnaire);
  if (Object.keys(answers).length === 0) {
    return { questionnaire_version: null, questionnaire_answers: null };
  }
  return {
    questionnaire_version: questionnaireRef(questionnaireForApplicant()),
    questionnaire_answers: answers,
  };
}

/**
 * Draft → the autosave payload (A2, D-APP3).
 *
 * ── WHY THIS ENUMERATES EVERY KEY INSTEAD OF SPREADING THE OBJECT ─────────────────────────────
 * Because of the one key that must never appear. §391.21(b)(2)'s Social Security number is asked for
 * in the final step and travels straight into `sealSsn` at submit, where it becomes a secretBox
 * envelope bound to the org. `application_drafts.payload` is plain jsonb in a table built to be
 * PRUNED, and nine digits do not go in it, ever.
 *
 * `{ ...draft }` would carry whatever the draft type grows next — and A3 grows it by adding the SSN
 * field. An explicit list cannot: a new field is invisible to autosave until somebody adds it here,
 * which is the correct default for a table holding a stranger's personal data. That is what "excluded
 * by construction" means, as against a filter on the way out, which is a line of code somebody can
 * delete without any test noticing.
 *
 * The server refuses a payload carrying an `ssn` key rather than stripping it, so a regression here
 * is loud on the very first save instead of silent until an audit.
 */
export function toDraftPayload(draft: ApplicationDraft): Record<string, unknown> {
  return {
    first_name: draft.first_name,
    middle_name: draft.middle_name,
    last_name: draft.last_name,
    other_names: draft.other_names,
    date_of_birth: draft.date_of_birth,
    email: draft.email,
    phone: draft.phone,
    addresses: draft.addresses,
    cdl_number: draft.cdl_number,
    cdl_state: draft.cdl_state,
    cdl_class: draft.cdl_class,
    cdl_expires_at: draft.cdl_expires_at,
    experience: draft.experience,
    equipment_experience: draft.equipment_experience,
    accidents: draft.accidents,
    declares_no_accidents: draft.declares_no_accidents,
    violations: draft.violations,
    declares_no_violations: draft.declares_no_violations,
    licence_ever_denied: draft.licence_ever_denied,
    licence_denial_detail: draft.licence_denial_detail,
    // ⚠ Absent from this list until 2026-09-11, and it is §40.25(j)'s two-year question — by this
    // file's own reckoning "the single most consequential answer on the form for what the carrier has
    // to do next". A driver who ticked it, closed the tab and came back had answered NO, silently,
    // because `fromDraftPayload` falls back to the empty draft for anything the payload omits. Both
    // halves of the round trip are pinned by "carries every answer the form can hold".
    prior_failed_pre_employment_test: draft.prior_failed_pre_employment_test,
    employers: draft.employers,
    declares_no_employment: draft.declares_no_employment,
    additional_licences: draft.additional_licences,
    // A9: the carrier's answers autosave like every other answer. They hold no Social Security
    // number and no field D-APP3 protects — the definition is fixed in code, so nothing the driver
    // types here can name a key the questionnaire did not ask for.
    questionnaire: draft.questionnaire,
    // `certified` and `signed_name` are deliberately absent too, for a different reason: §391.21(b)'s
    // certification is an act performed once, at submit, on the whole finished document. A saved
    // "I certify" checkbox would restore a certification the driver made about answers they have
    // since changed.
  };
}

/**
 * The saved payload → the form's working shape.
 *
 * Field by field, with the empty draft as the floor: the payload is unvalidated by design, so every
 * value in it may be missing, the wrong type, or left over from an older version of the form. A
 * resumed session must never be able to put the form into a state the form cannot render.
 */
export function fromDraftPayload(payload: Record<string, unknown> | null | undefined): ApplicationDraft {
  const base = emptyDraft();
  if (!payload || typeof payload !== "object") return base;

  const str = (k: keyof ApplicationDraft): string =>
    typeof payload[k] === "string" ? (payload[k] as string) : (base[k] as string);
  const bool = (k: keyof ApplicationDraft): boolean =>
    typeof payload[k] === "boolean" ? (payload[k] as boolean) : (base[k] as boolean);
  const rows = <T>(k: keyof ApplicationDraft, fallback: T[]): T[] =>
    Array.isArray(payload[k]) && (payload[k] as unknown[]).length > 0 ? (payload[k] as T[]) : fallback;

  /**
   * A stored state, as the code the picker can show (D-AX5).
   *
   * ⚠ **Without this, resuming a draft silently forgets where the driver lives.** These three fields
   * were free-text boxes capped at two characters until the jurisdiction picker replaced them, so a
   * saved draft can hold `il`, `Illinois` or `ILLINOIS` — none of which is an option value. A
   * combobox handed one of those finds no match and renders an empty field, and the driver comes back
   * to a form that has lost an answer they already gave, with nothing on screen saying so.
   *
   * A value that cannot be placed at all becomes `""` rather than travelling on invisibly: a blank
   * field is a thing the driver can see and fix, and a value the control cannot display but would
   * still submit is one nobody can.
   */
  const state = (v: unknown): string =>
    toJurisdictionCode(typeof v === "string" ? v : null) ?? "";

  return {
    ...base,
    first_name: str("first_name"),
    middle_name: str("middle_name"),
    last_name: str("last_name"),
    other_names: Array.isArray(payload.other_names)
      ? (payload.other_names as unknown[]).filter((n): n is string => typeof n === "string")
      : base.other_names,
    date_of_birth: str("date_of_birth"),
    email: str("email"),
    phone: str("phone"),
    addresses: rows<DraftAddress>("addresses", base.addresses).map((a) => ({ ...a, state: state(a.state) })),
    cdl_number: str("cdl_number"),
    cdl_state: state(payload.cdl_state),
    cdl_class: str("cdl_class"),
    cdl_expires_at: str("cdl_expires_at"),
    experience: str("experience"),
    equipment_experience: rows<DraftEquipment>("equipment_experience", base.equipment_experience),
    accidents: rows<DraftAccident>("accidents", base.accidents),
    declares_no_accidents: bool("declares_no_accidents"),
    violations: rows<DraftViolation>("violations", base.violations),
    declares_no_violations: bool("declares_no_violations"),
    licence_ever_denied: bool("licence_ever_denied"),
    licence_denial_detail: str("licence_denial_detail"),
    prior_failed_pre_employment_test: bool("prior_failed_pre_employment_test"),
    employers: rows<DraftEmployer>("employers", base.employers).map((e) => ({ ...e, state: state(e.state) })),
    declares_no_employment: bool("declares_no_employment"),
    additional_licences: rows<DraftLicence>("additional_licences", base.additional_licences),
    questionnaire:
      payload.questionnaire && typeof payload.questionnaire === "object" && !Array.isArray(payload.questionnaire)
        ? (payload.questionnaire as Record<string, unknown>)
        : base.questionnaire,
  };
}
