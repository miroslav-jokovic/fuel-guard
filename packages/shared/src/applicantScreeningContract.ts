import { z } from "zod";
import {
  CDL_CLASSES,
  ENDORSEMENT_CODES,
  isoDateSchema,
  requiredDateOfBirthSchema,
} from "./rosterContract.js";
import { JURISDICTIONS, JURISDICTION_CODES } from "./jurisdictions.js";
import { LICENSING_AUTHORITY_MAX_LENGTH } from "./mvrJurisdictions.js";
import { normalisePhone } from "./smsConsentContract.js";

/**
 * Part 1 of the applicant's link — "get started" — as a contract (APPLICATION-FLOW-V2-PLAN.md §6.2,
 * D-AW1..D-AW4, AW2), and the home of the office's screening routes as C2 adds them (§8.4).
 *
 * ── WHY PART 1 HAS ITS OWN CONTRACT AND NOT A SLICE OF THE APPLICATION'S ──────────────────────
 * The facts collected here are what the office screens on — the MVR is ordered per licence, the
 * drug-test site is found from the address, the quiet-hours zone of a text is derived from the state
 * — and they are collected WEEKS before the §391.21 form exists. So they are stored in their own
 * tables (`application_intakes`, `application_intake_licences`, 0376), written by one function
 * (`record_applicant_intake`, D-AW3), and never pruned, where the draft is pruned at 90 days (§2.3.2).
 * At certification the filed payload is composed from the draft plus these tables, so the certified
 * document still carries them.
 *
 * ── PRESENT KEYS ARE WRITTEN, ABSENT KEYS ARE KEPT ────────────────────────────────────────────
 * `record_applicant_intake` writes the keys a call carries and leaves the rest as stored, so each
 * Part 1 screen posts what it collected and nothing else. Every field here is therefore optional,
 * and `.strict()` is what keeps a screen from writing a key the function would silently ignore.
 *
 * ⚠ **§40.25(j) is judged on the row as it stands AFTER every write (0376, AI009, D-AW13).** A write
 * that leaves `prior_positive_2y` unanswered is refused, so the screening question must be answered
 * on or before the FIRST intake write — the M1 PR's fourth reading. Part 1's screens keep what they
 * collect before that question in the draft of the page, not on the server.
 */

// ── the vocabularies ─────────────────────────────────────────────────────────

/**
 * Where an applicant can live, for Part 1: a US state or district. The address feeds the drug-test
 * site search and the SMS quiet-hours zone (D-AW12), and the ZIP is five digits (0376's CHECK), so a
 * Canadian address has nowhere to go here — it is still a licence jurisdiction, below.
 */
export const US_JURISDICTION_CODES: ReadonlySet<string> = new Set(
  JURISDICTIONS.filter((j) => j.country === "US").map((j) => j.code),
);

/**
 * 0376's `application_intake_licences_number_check` (1–40 after trimming). Narrower than the
 * application's 60 (`applicationContract.ts`), and deliberately the database's number: a value this
 * accepted and the CHECK refused would surface as a 500 on a phone.
 */
export const INTAKE_LICENCE_NUMBER_MAX_LENGTH = 40;

/**
 * §391.21(b)(4) asks for every licence held in three years, and §383.21 lets a driver hold one CDL at
 * a time — so a long list is a typing loop, not a history. Ten is a ceiling on a request body, not a
 * rule about drivers.
 */
export const INTAKE_LICENCE_MAX = 10;

// ── the fields ───────────────────────────────────────────────────────────────

/**
 * A US mobile number, normalised to the E.164 form 0376 CHECKs (`^\+1[2-9][0-9]{9}$`).
 *
 * US-only because the SMS provider is, and because a number the drain could never text is a number
 * the office would believe reaches the driver (G-2). `normalisePhone` is the same normaliser the STOP
 * handling matches inbound numbers with, so the stored form and the matched form cannot drift.
 */
export const usMobilePhoneSchema = z
  .string()
  .trim()
  .min(7)
  .max(40)
  .transform((raw, ctx) => {
    const e164 = normalisePhone(raw);
    if (!e164 || !/^\+1[2-9]\d{9}$/.test(e164)) {
      ctx.addIssue({ code: "custom", message: "Enter a US mobile number, ten digits" });
      return z.NEVER;
    }
    return e164;
  });

const usStateSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => US_JURISDICTION_CODES.has(v), "Choose a US state");

const jurisdictionCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => JURISDICTION_CODES.has(v), "Choose the state or province that issued it");

/**
 * `POST /api/public/application/:token/intake` — one Part 1 screen's answers.
 *
 * ⚠ The FCRA summary acknowledgement is NOT here yet. `complete_applicant_intake` refuses (AI007)
 * until `fcra_summary_shown_at` is stamped, and that stamp records WHICH text was shown — a version
 * that has to name text in this repository. The text is AW3's (C3), pending Q-AW13 (CFPB Appendix K
 * meanwhile); it arrives with its version and a field here in the same merge, never as a version
 * string for text nobody can read.
 */
export const applicantIntakeSchema = z
  .object({
    date_of_birth: requiredDateOfBirthSchema.optional(),
    phone: usMobilePhoneSchema.optional(),
    address_line1: z.string().trim().min(1).max(200).optional(),
    address_line2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state: usStateSchema.optional(),
    postal_code: z.string().trim().regex(/^\d{5}$/, "A ZIP code is five digits").optional(),
    /** `drivers.cdl_class` (0098) — the roster's own vocabulary. */
    cdl_class: z.enum(CDL_CLASSES).optional(),
    /** §40.25(j): a positive test or a refusal on a DOT pre-employment test in the past two years. */
    prior_positive_2y: z.boolean().optional(),
    /**
     * §382.301(b): in a DOT testing program in the previous 30 days, and tested in the past six months
     * or in a random program for the previous twelve. LEADS ONLY — the exception is the employer's to
     * verify (§382.301(b)(3), (c)), never the applicant's to claim.
     */
    dot_program_30d: z.boolean().optional(),
    dot_tested_6m: z.boolean().optional(),
    dot_random_12m: z.boolean().optional(),
    /** D-AW4: "I don't have a medical card yet" is an answer, and lets Part 1 finish without one. */
    medical_card_pending: z.boolean().optional(),
    /**
     * The endorsements the applicant DECLARES, in the roster's letters (`ENDORSEMENT_CODES`, which
     * 0376's `application_intakes_endorsements_check` admits). Kept on the intake row only:
     * `certifications` kind `endorsement` needs an `effective_from` an applicant's claim does not
     * carry, so a declaration is not turned into a certification (0376's column comment; the M1 PR's
     * first reading, decided here: it stays a declaration until the office verifies it on the MVR).
     */
    endorsements: z.array(z.enum(ENDORSEMENT_CODES)).max(ENDORSEMENT_CODES.length).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to save");
export type ApplicantIntake = z.infer<typeof applicantIntakeSchema>;

/**
 * One licence held in the past three years. Its POSITION is its place in the list, and position 0 is
 * the current CDL — the one PSP matches and the one `record_applicant_identity` writes onto `drivers`.
 */
export const applicantIntakeLicenceSchema = z
  .object({
    state_code: jurisdictionCodeSchema,
    /** The issuing authority's name, for a licence that is not a US state's (A-3's one ceiling). */
    agency: z.string().trim().min(1).max(LICENSING_AUTHORITY_MAX_LENGTH).nullish(),
    licence_number: z.string().trim().min(1).max(INTAKE_LICENCE_NUMBER_MAX_LENGTH),
    expires_on: isoDateSchema,
  })
  .strict();
export type ApplicantIntakeLicence = z.infer<typeof applicantIntakeLicenceSchema>;

/**
 * `POST /api/public/application/:token/intake/licences` — the whole list, replacing what is stored.
 *
 * Whole-list rather than one-at-a-time because the function replaces it whole (0376) and because the
 * positions are the order the driver gave: a per-item call would need positions the client invents.
 * The duplicate refusal restates 0376's `application_intake_licences_licence_key` in words, so the
 * driver is told which entry and the database never answers 23505.
 */
export const applicantIntakeLicencesSchema = z
  .object({
    licences: z.array(applicantIntakeLicenceSchema).min(1).max(INTAKE_LICENCE_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.licences.forEach((l, i) => {
      const key = `${l.state_code}|${l.licence_number.toUpperCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", message: "This licence is already on the list", path: ["licences", i] });
      }
      seen.add(key);
    });
  });
export type ApplicantIntakeLicences = z.infer<typeof applicantIntakeLicencesSchema>;

/**
 * The slots Part 1 photographs and `complete_applicant_intake` promotes to `documents` (D-AW4). The
 * selfie is not here and never will be: it is never promoted (0376), and it is AW6's, after Q-AW5.
 */
export const INTAKE_CAPTURE_SLOTS = ["cdl_front", "cdl_back", "medical_card"] as const;

// ── the office's acts (C2b2) ─────────────────────────────────────────────────

/** 0376's `applicant_travel_mode_check`, in its order. */
export const TRAVEL_MODES = ["air", "bus", "train", "drive", "other"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  air: "Flight",
  bus: "Bus",
  train: "Train",
  drive: "Driving",
  other: "Other",
};

/**
 * A time as the office reads it off an itinerary: `YYYY-MM-DDTHH:MM`, what `<input
 * type="datetime-local">` produces.
 *
 * ⚠ **The CARRIER's clock, never the viewer's, and never an instant from the browser.** The server
 * turns it into an instant with `wallClockToUtc` in `organizationTimezone` — the rule every date in
 * this product follows (`calendarDay.ts`, D-PREC6) — so an office working from a laptop set to another
 * zone books the same trip as one at the desk. The form says which zone it means.
 */
export const carrierWallTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Expected a date and time as YYYY-MM-DDTHH:MM");

/** 0376 holds `confirmation_ref` as free text; a booking reference is short, and this is a body ceiling. */
export const TRAVEL_CONFIRMATION_MAX_LENGTH = 100;

/**
 * Recording the applicant's trip to the office (D-AW7, AW11) — `POST
 * /recruitment/applicants/:driverId/travel`. The writer refuses until every step before travel is done
 * (`TRAVEL_REFUSES_WITHOUT`); a second booking replaces the live one (a changed flight is a new trip).
 *
 * ⚠ Arrival not before departure is 0376's `applicant_travel_order_check`, checked here on the wall
 * times so the office is told which field, instead of a 500 from the CHECK. Both are read in the one
 * zone, so the comparison is the same one the database makes.
 */
export const applicantTravelSchema = z
  .object({
    mode: z.enum(TRAVEL_MODES),
    depart_at: carrierWallTimeSchema,
    arrive_at: carrierWallTimeSchema,
    confirmation_ref: z.string().trim().max(TRAVEL_CONFIRMATION_MAX_LENGTH).nullish(),
  })
  .strict()
  .refine((t) => t.arrive_at >= t.depart_at, {
    path: ["arrive_at"],
    message: "The arrival can't be before the departure.",
  });
export type ApplicantTravelBooking = z.infer<typeof applicantTravelSchema>;

/** One trip as the office's drawer reads it. Instants, with the zone they were entered in. */
export interface ApplicantTravel {
  id: string;
  mode: TravelMode;
  departAt: string;
  arriveAt: string;
  confirmationRef: string | null;
  bookedAt: string;
  cancelledAt: string | null;
}

/** `GET …/travel`: the live invitation's trips, newest first, and the zone the times are shown in. */
export interface ApplicantTravelList {
  trips: ApplicantTravel[];
  timeZone: string;
}
