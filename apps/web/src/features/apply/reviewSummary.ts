import {
  APPLICATION_CAPTURE_REQUESTED,
  APPLICATION_SECTION_LABELS,
  APPLICATION_CAPTURE_SLOT_LABELS,
  EQUIPMENT_CLASS_LABELS,
  jurisdictionName,
  readableAnswers,
  type ApplicationCaptureView,
  type ApplicationSection,
  type EquipmentClass,
  type QuestionnaireDefinition,
  type QuestionnaireQuestion,
} from "@silvicom/shared";
import { APPLY_COPY } from "./strings";
import type { ApplicationDraft } from "./draft";

/**
 * The application, laid back out for the person about to swear it is true (D-AX6).
 *
 * ── WHY THIS IS A PURE FUNCTION AND NOT A TEMPLATE ────────────────────────────────────────────
 * `ReviewFields.vue`'s own docstring already said what this screen is for — *"not as a pretty
 * summary but as the answers themselves"* — and then rendered `"3 employers"`, `"2 accidents"`,
 * `"1 conviction"`, omitting the equipment grid, the other names, the §40.25(j) answer, every
 * questionnaire answer and every photograph.
 *
 * ⚠ **That is the one defect in this flow that is also a legal-quality defect.** §391.21(b)(12) has
 * the applicant certify that *all entries on it* are true and complete, and the screen immediately
 * before the certification was not showing the entries. Nobody can swear to what they cannot see.
 *
 * Building the summary as DATA rather than as markup is what makes the fix checkable: a test can
 * walk a filled-in draft and assert that every answer in it reaches the screen. A template can only
 * be read and agreed with.
 *
 * ── WHAT IS DELIBERATELY NOT ON IT ────────────────────────────────────────────────────────────
 * The Social Security number. It is not part of the certified payload — it never enters a draft at
 * all (D-APP3) — and reprinting nine digits on a summary screen in a truck stop is the opposite of
 * what the rest of that decision spends its effort on.
 */

export interface ReviewEntry {
  label: string;
  value: string;
  /** Rendered quietly: a "none" or a "not answered" is a real answer but not one to shout. */
  muted?: boolean;
}

/** One card on the screen — a whole address, a whole employer, or a screen's plain answers. */
export interface ReviewGroup {
  /** "Employer 2". Absent for a group that is the screen's only one. */
  title?: string;
  entries: ReviewEntry[];
}

export interface ReviewSection {
  section: ApplicationSection;
  heading: string;
  groups: ReviewGroup[];
}

const copy = APPLY_COPY.review;

/** `2026-04-01` → `04/01/2026`, the way every picker in this form displays a date. */
export function showDate(iso: string | null | undefined): string {
  const v = (iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

/** `2024-03` → `03/2024`, the way `AppMonthField` displays a month. */
export function showMonth(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  return m ? `${m[2]}/${m[1]}` : v;
}

const text = (v: string | null | undefined): string =>
  (v ?? "").trim() === "" ? copy.empty : (v ?? "").trim();

const yesNo = (v: boolean): string => (v ? "Yes" : "No");

/** "Illinois (IL)", matching the picker — a driver should recognise what they chose. */
const place = (code: string): string => {
  const trimmed = code.trim();
  if (trimmed === "") return copy.empty;
  const name = jurisdictionName(trimmed);
  return name ? `${name} (${trimmed.toUpperCase()})` : trimmed;
};

/** A period. An open end is "now" rather than blank — a blank reads as a missing answer. */
const period = (from: string, to: string, month: boolean): string => {
  const show = month ? showMonth : showDate;
  const start = show(from);
  if (start === "") return copy.empty;
  return `${start} — ${to.trim() === "" ? "now" : show(to)}`;
};

/**
 * One questionnaire answer, beside the question that produced it.
 *
 * ⚠ A stored answer is meaningless without its question, which is why the DEFINITION is a parameter
 * rather than something this module reaches for. A driver reviewing a `table` answer sees each row
 * as one line of "column: value" pairs — flattening it to a count would repeat on this screen the
 * exact mistake the screen is being fixed for.
 */
function answerText(question: QuestionnaireQuestion, raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return copy.empty;
  if (typeof raw === "boolean") return yesNo(raw);
  if (Array.isArray(raw)) {
    const rows = raw
      .map((row) =>
        (question.columns ?? [])
          .map((c) => {
            const cell = (row as Record<string, unknown>)[c.id];
            if (cell === undefined || cell === null || cell === "") return null;
            return `${c.label}: ${typeof cell === "boolean" ? yesNo(cell) : String(cell)}`;
          })
          .filter((s): s is string => s !== null)
          .join(", "),
      )
      .filter((s) => s !== "");
    return rows.length === 0 ? copy.empty : rows.join(" · ");
  }
  return String(raw);
}

export interface ReviewInput {
  draft: ApplicationDraft;
  questionnaire: QuestionnaireDefinition;
  captures: readonly ApplicationCaptureView[];
}

export function buildReviewSummary({ draft, questionnaire, captures }: ReviewInput): ReviewSection[] {
  const c = APPLY_COPY;
  const answers = readableAnswers(draft.questionnaire);

  const identity: ReviewGroup[] = [
    {
      entries: [
        { label: "Name", value: text([draft.first_name, draft.middle_name, draft.last_name].filter((p) => p.trim()).join(" ")) },
        {
          label: c.identity.otherNames,
          value: draft.other_names.filter((n) => n.trim()).join(", ") || copy.none,
          muted: draft.other_names.filter((n) => n.trim()).length === 0,
        },
        { label: c.identity.date_of_birth, value: showDate(draft.date_of_birth) || copy.empty },
        { label: c.identity.email, value: text(draft.email) },
        { label: c.identity.phone, value: text(draft.phone) },
      ],
    },
  ];

  const addresses: ReviewGroup[] = draft.addresses.length === 0
    ? [{ entries: [{ label: "Addresses", value: copy.empty, muted: true }] }]
    : draft.addresses.map((a, i) => ({
      title: `Address ${i + 1}`,
      entries: [
        { label: c.addresses.line1, value: text([a.line1, a.line2].filter((p) => p.trim()).join(", ")) },
        { label: c.addresses.city, value: text([a.city.trim(), place(a.state), a.postal_code.trim()].filter((p) => p && p !== copy.empty).join(", ")) },
        { label: "Lived there", value: period(a.from, a.to, true) },
      ],
    }));

  const licence: ReviewGroup[] = [
    {
      entries: [
        { label: c.licence.number, value: text(draft.cdl_number) },
        { label: c.licence.state, value: place(draft.cdl_state) },
        { label: c.licence.class, value: text(draft.cdl_class) },
        { label: c.licence.expires, value: showDate(draft.cdl_expires_at) || copy.empty },
      ],
    },
    ...draft.additional_licences.map((l, i) => ({
      title: `Licence ${i + 1}`,
      entries: [
        { label: c.licence.issuingAuthority, value: text(l.issuing_authority) },
        { label: c.licence.otherNumber, value: text(l.number) },
        { label: c.licence.expires, value: showDate(l.expires_at) || copy.empty },
        { label: c.licence.otherKind, value: text(l.kind) },
      ],
    })),
  ];

  const employment: ReviewGroup[] = draft.declares_no_employment
    ? [{ entries: [{ label: c.employment.none, value: "Yes" }] }]
    : draft.employers.map((e, i) => ({
      title: `Employer ${i + 1}`,
      entries: [
        { label: c.employment.employer, value: text(e.employer_name) },
        { label: c.employment.position, value: text(e.position_held) },
        { label: "Worked there", value: period(e.started_on, e.ended_on, false) },
        { label: "Where", value: text([e.address_line1.trim(), e.city.trim(), e.state.trim() ? place(e.state) : ""].filter((p) => p).join(", ")) },
        { label: c.employment.phone, value: text(e.phone) },
        { label: c.employment.reason, value: text(e.reason_for_leaving) },
        { label: c.employment.operatedCmv, value: yesNo(e.operated_cmv) },
        { label: c.employment.dotRegulated, value: yesNo(e.dot_regulated) },
      ],
    }));

  employment.push({
    title: c.employment.equipmentHeading,
    entries: [
      { label: c.employment.experience, value: text(draft.experience) },
      ...(draft.equipment_experience.length === 0
        ? [{ label: "Equipment", value: copy.none, muted: true }]
        : draft.equipment_experience.map((e, i) => ({
          label: `Equipment ${i + 1}`,
          value: [
            e.equipment_class === "" ? copy.empty : EQUIPMENT_CLASS_LABELS[e.equipment_class as EquipmentClass],
            e.equipment_type.trim(),
            period(e.from, e.to, true),
            e.approx_miles.trim() === "" ? "" : `${e.approx_miles.trim()} miles`,
          ].filter((p) => p && p !== copy.empty).join(" · "),
        }))),
    ],
  });

  const safety: ReviewGroup[] = [
    {
      title: c.safety.accidentsHeading,
      entries: draft.declares_no_accidents || draft.accidents.length === 0
        ? [{ label: c.safety.accidentsHeading, value: draft.declares_no_accidents ? copy.none : copy.empty, muted: true }]
        : draft.accidents.map((a, i) => ({
          label: `Accident ${i + 1}`,
          value: [
            showDate(a.occurred_on),
            a.nature.trim(),
            `${a.fatalities || "0"} fatalities`,
            `${a.injuries || "0"} injuries`,
            a.hazmat_spill ? c.safety.hazmatSpill : "",
          ].filter((p) => p).join(" · "),
        })),
    },
    {
      title: c.safety.violationsHeading,
      entries: draft.declares_no_violations || draft.violations.length === 0
        ? [{ label: c.safety.violationsHeading, value: draft.declares_no_violations ? copy.none : copy.empty, muted: true }]
        : draft.violations.map((v, i) => ({
          label: `Conviction ${i + 1}`,
          value: [showDate(v.occurred_on), v.offence.trim(), v.state.trim() ? place(v.state) : "", v.penalty.trim()]
            .filter((p) => p).join(" · "),
        })),
    },
    {
      title: c.safety.licenceHeading,
      entries: [
        {
          label: c.safety.everDenied,
          value: draft.licence_ever_denied ? text(draft.licence_denial_detail) : "No",
          muted: !draft.licence_ever_denied,
        },
        // §40.25(j) (P8). It was on no summary at all, and it is the single most consequential
        // answer on the form for what the carrier has to do next.
        {
          label: c.safety.priorTestHeading,
          value: yesNo(draft.prior_failed_pre_employment_test),
          muted: !draft.prior_failed_pre_employment_test,
        },
      ],
    },
  ];

  const questions: ReviewGroup[] = [
    {
      entries: questionnaire.questions.map((q) => ({
        label: q.label,
        value: answerText(q, answers[q.id]),
        muted: answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === "",
      })),
    },
  ];

  const taken = new Set(captures.map((cap) => cap.slot));
  const documents: ReviewGroup[] = [
    {
      entries: APPLICATION_CAPTURE_REQUESTED.map((slot) => ({
        label: APPLICATION_CAPTURE_SLOT_LABELS[slot],
        value: taken.has(slot) ? APPLY_COPY.documents.done : copy.none,
        muted: !taken.has(slot),
      })),
    },
  ];

  return [
    // ⚠ Headings come from `APPLICATION_SECTION_LABELS`, not from strings written here. The summary
    // and the step header the driver just walked past have to call each screen the same thing, or
    // "go back and fix it" sends them looking for a section that appears to no longer exist.
    { section: "identity", heading: APPLICATION_SECTION_LABELS.identity, groups: identity },
    { section: "addresses", heading: APPLICATION_SECTION_LABELS.addresses, groups: addresses },
    { section: "licence", heading: APPLICATION_SECTION_LABELS.licence, groups: licence },
    { section: "employment", heading: APPLICATION_SECTION_LABELS.employment, groups: employment },
    { section: "safety", heading: APPLICATION_SECTION_LABELS.safety, groups: safety },
    { section: "questions", heading: APPLICATION_SECTION_LABELS.questions, groups: questions },
    { section: "documents", heading: APPLICATION_SECTION_LABELS.documents, groups: documents },
  ];
}
