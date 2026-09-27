import {
  CDL_CLASSES,
  ENDORSEMENT_CODES,
  applicantIntakeLicenceSchema,
  applicantIntakeLicencesSchema,
  applicantIntakeSchema,
  requiredDateOfBirthSchema,
  usMobilePhoneSchema,
  type ApplicantIntake,
  type ApplicantIntakeLicence,
  type AamvaLicence,
  type ApplicationCaptureView,
  type PartOneStatus,
} from "@silvicom/shared";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * Part 1's screens as data and pure rules (APPLICATION-FLOW-V2-PLAN.md §6.2, D-AW11, AW3, C3a) — the
 * order, what each screen checks, where a returning applicant resumes, and the ORDER of the first
 * write. No IO here: `usePartOne` does the posting, and every rule below is one line to test.
 *
 * ── WHY SCREENS 3–6 ARE HELD IN THE PAGE UNTIL SCREEN 7 ──────────────────────────────────────
 * 0376 judges §40.25(j) on the intake row as it stands after EVERY write (AI009, D-AW13): a write that
 * leaves it unanswered is refused. The question is screen 7, so screens 3–6 cannot be saved before it —
 * the M1 PR's fourth reading, and `applicantScreeningContract.ts`'s header. Their answers are held
 * here and posted by `firstWrite` when screen 7 is answered. ⚠ Until AW10 (C3d) replays a local draft,
 * a reload before screen 7 loses up to four screens of typing; that is recorded in plan §12, not
 * hidden by reordering the owner's screens.
 *
 * ── AND WHY THE FIRST WRITE IS THREE CALLS IN THIS ORDER ─────────────────────────────────────
 * 0376 writes the date of birth only THROUGH `record_applicant_identity`, and only once the current
 * licence exists (position 0 of the licence list) — a date of birth sent before the licences is
 * dropped without a word. And the licences cannot be sent before §40.25(j). So: (1) the answers,
 * including §40.25(j); (2) the licences; (3) the date of birth. Any other order loses a fact.
 */

/**
 * ⚠ **The CDL's two photographs come FIRST** (Q-AW31, default built in C3b1). §6.2's table put them at
 * 8–9, after the typed licence screens, while the same table says those screens are "prefilled from
 * the barcode on screen 9" — which no order but this can do: a prefill that never overwrites typed
 * input (§6.6.4) has nothing left to fill once screens 3–5 are typed, and the date of birth, once
 * written, is fill-only for the applicant (0376 → `record_applicant_identity`), so a later "correction"
 * from the barcode would be dropped. Captures are open from the 7001(c) consent onward (AF3), so
 * photographing first needs nothing from the server. The medical card stays after the questions.
 */
export const PART_ONE_SCREENS = [
  "cdl_front",
  "cdl_back",
  "about",
  "address",
  "licence",
  "otherLicences",
  "screening",
  "medical_card",
  "rights",
] as const;
export type PartOneScreen = (typeof PART_ONE_SCREENS)[number];

/** The screens whose answers wait for screen 7 on a link that has not begun (see the header). */
export const HELD_UNTIL_SCREENING: readonly PartOneScreen[] = ["about", "address", "licence", "otherLicences"];

export const PHOTO_SCREENS = ["cdl_front", "cdl_back", "medical_card"] as const;
export type PhotoScreen = (typeof PHOTO_SCREENS)[number];
export const isPhotoScreen = (s: PartOneScreen): s is PhotoScreen =>
  (PHOTO_SCREENS as readonly string[]).includes(s);

export interface OtherLicence {
  state_code: string;
  agency: string;
  licence_number: string;
  expires_on: string;
}

export interface PartOneAnswers {
  phone: string;
  date_of_birth: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  cdl: { state_code: string; licence_number: string; cdl_class: string; expires_on: string; endorsements: string[] };
  /** "In the past 3 years, another licence?" — null until answered. */
  otherHeld: boolean | null;
  others: OtherLicence[];
  prior_positive_2y: boolean | null;
  dot_program_30d: boolean | null;
  dot_tested_6m: boolean | null;
  dot_random_12m: boolean | null;
  medical_card_pending: boolean;
}

export const emptyPartOneAnswers = (): PartOneAnswers => ({
  phone: "",
  date_of_birth: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  cdl: { state_code: "", licence_number: "", cdl_class: "", expires_on: "", endorsements: [] },
  otherHeld: null,
  others: [],
  prior_positive_2y: null,
  dot_program_30d: null,
  dot_tested_6m: null,
  dot_random_12m: null,
  medical_card_pending: false,
});

export type ScreenErrors = Record<string, string>;
const copy = APPLY_COPY.partOne;

/** The schema's own rule when a value was typed ("at least 18"), the screen's sentence when it was blank. */
function fieldIssue(value: string, blank: string, parse: () => { success: boolean; error?: { issues: Array<{ message: string }> } }): string | null {
  if (value.trim() === "") return blank;
  const parsed = parse();
  return parsed.success ? null : (parsed.error?.issues[0]?.message ?? blank);
}

export function validateAbout(a: PartOneAnswers): ScreenErrors {
  const errors: ScreenErrors = {};
  if (a.phone.trim() === "") errors.phone = copy.about.missingPhone;
  else if (!usMobilePhoneSchema.safeParse(a.phone).success) errors.phone = copy.about.badPhone;
  const dob = fieldIssue(a.date_of_birth, copy.about.missingDateOfBirth, () => requiredDateOfBirthSchema.safeParse(a.date_of_birth));
  if (dob) errors.date_of_birth = dob;
  return errors;
}

const ADDRESS_FIELDS = ["address_line1", "city", "state", "postal_code"] as const;

export function validateAddress(a: PartOneAnswers): ScreenErrors {
  const errors: ScreenErrors = {};
  const parsed = applicantIntakeSchema.safeParse(addressPayload(a));
  for (const key of ADDRESS_FIELDS) {
    if (a[key].trim() === "") errors[key] = copy.address.missing[key];
  }
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  return errors;
}

export function validateLicence(a: PartOneAnswers): ScreenErrors {
  const errors: ScreenErrors = {};
  const m = copy.licence.missing;
  if (a.cdl.state_code.trim() === "") errors.state_code = m.state_code;
  if (a.cdl.licence_number.trim() === "") errors.licence_number = m.licence_number;
  if (!(CDL_CLASSES as readonly string[]).includes(a.cdl.cdl_class)) errors.cdl_class = m.cdl_class;
  if (a.cdl.expires_on.trim() === "") errors.expires_on = m.expires_on;
  if (Object.keys(errors).length > 0) return errors;
  const parsed = applicantIntakeLicenceSchema.safeParse(currentLicence(a));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
  }
  return errors;
}

/**
 * One other licence, before it joins the list — state and number required, as 0376 requires them, and
 * the expiry date as the contract requires it (Q-AW35 (a)): filing refuses a licence without one, and
 * this is the only screen that can ever ask.
 */
export function validateOtherLicence(entry: OtherLicence, a: PartOneAnswers): ScreenErrors {
  const errors: ScreenErrors = {};
  const o = copy.otherLicences;
  if (entry.state_code.trim() === "") errors.state_code = o.missingState;
  if (entry.licence_number.trim() === "") errors.licence_number = o.missingNumber;
  if (entry.expires_on.trim() === "") errors.expires_on = o.missingExpiry;
  if (Object.keys(errors).length > 0) return errors;
  const parsed = applicantIntakeLicenceSchema.safeParse(otherPayload(entry));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
    return errors;
  }
  // 0376's unique (invitation, state, number), in words, before the database says 23505.
  const key = `${entry.state_code.toUpperCase()}|${entry.licence_number.trim().toUpperCase()}`;
  const taken = [currentLicence(a), ...a.others.map(otherPayload)].some(
    (l) => `${l.state_code.toUpperCase()}|${l.licence_number.trim().toUpperCase()}` === key,
  );
  if (taken) errors.licence_number = o.duplicate;
  return errors;
}

export function validateOtherLicences(a: PartOneAnswers): ScreenErrors {
  if (a.otherHeld === null) return { otherHeld: copy.otherLicences.answerFirst };
  if (a.otherHeld && a.others.length === 0) return { otherHeld: copy.otherLicences.needOne };
  return {};
}

export function validateScreening(a: PartOneAnswers): ScreenErrors {
  const errors: ScreenErrors = {};
  const need = copy.screening.answer;
  if (a.prior_positive_2y === null) errors.prior_positive_2y = need;
  if (a.dot_program_30d === null) errors.dot_program_30d = need;
  if (a.dot_program_30d === true) {
    if (a.dot_tested_6m === null) errors.dot_tested_6m = need;
    if (a.dot_random_12m === null) errors.dot_random_12m = need;
  }
  return errors;
}

// ── what each screen posts ────────────────────────────────────────────────────────────────────

export const aboutPayload = (a: PartOneAnswers): ApplicantIntake => ({ phone: a.phone.trim(), date_of_birth: a.date_of_birth });

export const addressPayload = (a: PartOneAnswers): ApplicantIntake => ({
  address_line1: a.address_line1.trim(),
  address_line2: a.address_line2.trim() === "" ? null : a.address_line2.trim(),
  city: a.city.trim(),
  state: a.state,
  postal_code: a.postal_code.trim(),
});

export const cdlPayload = (a: PartOneAnswers): ApplicantIntake => ({
  cdl_class: a.cdl.cdl_class as (typeof CDL_CLASSES)[number],
  endorsements: a.cdl.endorsements.filter((c): c is (typeof ENDORSEMENT_CODES)[number] =>
    (ENDORSEMENT_CODES as readonly string[]).includes(c)),
});

/**
 * The screening answers. The two follow-ups are sent only when they were asked — a "No" to the 30-day
 * program makes them moot, and sending the stale answer of a changed mind would store a lead nobody
 * gave.
 */
export const screeningPayload = (a: PartOneAnswers): ApplicantIntake => ({
  prior_positive_2y: a.prior_positive_2y ?? undefined,
  dot_program_30d: a.dot_program_30d ?? undefined,
  ...(a.dot_program_30d
    ? { dot_tested_6m: a.dot_tested_6m ?? undefined, dot_random_12m: a.dot_random_12m ?? undefined }
    : {}),
});

const currentLicence = (a: PartOneAnswers): ApplicantIntakeLicence => ({
  state_code: a.cdl.state_code,
  licence_number: a.cdl.licence_number.trim(),
  expires_on: a.cdl.expires_on,
});

const otherPayload = (o: OtherLicence): ApplicantIntakeLicence => ({
  state_code: o.state_code,
  agency: o.agency.trim() === "" ? null : o.agency.trim(),
  licence_number: o.licence_number.trim(),
  expires_on: o.expires_on,
});

/** The whole list, current CDL first — the positions ARE the order (0376). */
export function licenceList(a: PartOneAnswers): ApplicantIntakeLicence[] {
  const others = a.otherHeld ? a.others.map(otherPayload) : [];
  return applicantIntakeLicencesSchema.parse({ licences: [currentLicence(a), ...others] }).licences;
}

export type PartOneWrite =
  | { kind: "intake"; body: ApplicantIntake }
  | { kind: "licences"; body: ApplicantIntakeLicence[] };

/** The first write, in the one order that loses nothing — see the header. */
export function firstWrite(a: PartOneAnswers): PartOneWrite[] {
  return [
    {
      kind: "intake",
      body: { ...screeningPayload(a), phone: a.phone.trim(), ...addressPayload(a), ...cdlPayload(a) },
    },
    { kind: "licences", body: licenceList(a) },
    { kind: "intake", body: { date_of_birth: a.date_of_birth } },
  ];
}

// ── where a returning applicant resumes ───────────────────────────────────────────────────────

const hasCapture = (captures: readonly ApplicationCaptureView[], slot: string): boolean =>
  captures.some((c) => c.slot === slot);

/** Is this photo screen satisfied — a capture on file, or (medical card only) "I don't have one yet"? */
export function photoDone(
  screen: PhotoScreen,
  captures: readonly ApplicationCaptureView[],
  medicalCardPending: boolean,
): boolean {
  return hasCapture(captures, screen) || (screen === "medical_card" && medicalCardPending);
}

/**
 * The first screen still owed. Before §40.25(j) is on file nothing of screens 3–6 is (they wait for
 * it), so an unbegun link starts at the beginning. After it, screens 3–7 were posted together and only
 * the date of birth can be missing — `identityComplete` is the bundle's word for it.
 */
export function resumeScreen(
  status: PartOneStatus,
  identityComplete: boolean,
  captures: readonly ApplicationCaptureView[],
): PartOneScreen {
  for (const screen of ["cdl_front", "cdl_back"] as const) {
    if (!photoDone(screen, captures, status.medicalCardPending)) return screen;
  }
  if (!status.screening || !status.contact || !identityComplete) return "about";
  if (!status.address) return "address";
  if (!status.licences) return "licence";
  if (!photoDone("medical_card", captures, status.medicalCardPending)) return "medical_card";
  return "rights";
}

// ── what the licence's barcode fills in (AW5, §6.6.4) ─────────────────────────────────────────

/** The answers a barcode can fill, grouped by the screen that shows them. Part 1 has no name box. */
export const PREFILL_FIELDS = {
  about: ["date_of_birth"],
  address: ["address_line1", "address_line2", "city", "state", "postal_code"],
  licence: ["cdl.state_code", "cdl.licence_number", "cdl.expires_on"],
} as const satisfies Partial<Record<PartOneScreen, readonly string[]>>;
export type PrefilledField = (typeof PREFILL_FIELDS)[keyof typeof PREFILL_FIELDS][number];

const blankAll = (...values: string[]): boolean => values.every((v) => v.trim() === "");

/**
 * Fill what the driver has not typed from what their licence says, and name what was filled.
 *
 * ⚠ **Blanks only, and a block only when the WHOLE block is blank.** The address and the current
 * licence each fill as one piece or not at all: a typed street beside the barcode's city, or a typed
 * number beside the barcode's issuing state, would be a record that is neither the driver's answer nor
 * the licence's. The date of birth stands alone. Nothing is ever replaced — the driver's own typing
 * wins, including typing done on a screen they then came back from.
 *
 * The filled values are shown in their boxes for the driver to check before Continue; nothing is
 * written from here. The first write's order (`firstWrite`) is unchanged, because this only changes
 * what the boxes hold before it runs.
 */
export function prefillFromLicence(a: PartOneAnswers, l: AamvaLicence): PrefilledField[] {
  const filled: PrefilledField[] = [];
  if (l.dateOfBirth && blankAll(a.date_of_birth)) {
    a.date_of_birth = l.dateOfBirth;
    filled.push("date_of_birth");
  }
  const addr = l.address;
  if (addr.line1 && addr.city && blankAll(a.address_line1, a.address_line2, a.city, a.state, a.postal_code)) {
    a.address_line1 = addr.line1;
    a.address_line2 = addr.line2 ?? "";
    a.city = addr.city;
    a.state = addr.state ?? "";
    a.postal_code = addr.postalCode ?? "";
    filled.push(...PREFILL_FIELDS.address.filter((k) => a[k] !== ""));
  }
  const cdl = a.cdl;
  if (l.licenceNumber && blankAll(cdl.state_code, cdl.licence_number, cdl.expires_on)) {
    cdl.licence_number = l.licenceNumber;
    cdl.state_code = l.issuingState ?? "";
    cdl.expires_on = l.expiresOn ?? "";
    filled.push("cdl.licence_number");
    if (cdl.state_code) filled.push("cdl.state_code");
    if (cdl.expires_on) filled.push("cdl.expires_on");
  }
  return filled;
}
