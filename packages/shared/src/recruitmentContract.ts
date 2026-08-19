import { z } from "zod";
import { isoDateSchema } from "./rosterContract.js";

/**
 * Recruitment API contract — `/api/recruitment/*`.
 *
 * ONE SOURCE OF TRUTH for the §391.21(b)(10) employment list (migration 0208), consumed by the API
 * for request validation and by the web for typed reads. The gap arithmetic over these rows lives in
 * `employmentCoverage.ts`, pure and separately tested.
 *
 * Recruitment is its OWN `AppSection` (`auth.ts`), not a corner of Fleet. The first cut of this
 * gated on `fleet` on the theory that a seventh section would have to be mirrored into the SQL
 * section helpers — **there are none**: `0078_role_department_rls.sql` derived each policy from
 * `rolesThatManage(section)` by hand, per table. The section costs the matrix and its consumers, and
 * it buys a boundary that does matter: hiring paperwork has a different audience from the vehicle
 * roster, and §391.53(a)(1) limits the investigation history to those making the hiring decision.
 */

export const EMPLOYMENT_INQUIRY_STATUSES = [
  "not_required",
  "pending",
  "sent",
  "responded",
  "no_response",
] as const;
export type EmploymentInquiryStatus = (typeof EMPLOYMENT_INQUIRY_STATUSES)[number];

export const EMPLOYMENT_INQUIRY_LABELS: Record<EmploymentInquiryStatus, string> = {
  not_required: "Not required",
  pending: "Not sent",
  sent: "Awaiting response",
  responded: "Responded",
  // §391.23(d) explicitly allows a carrier to rely on a documented non-response, so this is an
  // OUTCOME and the label must not read like a failure.
  no_response: "No response (documented)",
};

export const EMPLOYMENT_SOURCES = ["application", "psp_discovery", "manual"] as const;
export type EmploymentSource = (typeof EMPLOYMENT_SOURCES)[number];

export const EMPLOYMENT_SOURCE_LABELS: Record<EmploymentSource, string> = {
  application: "Declared on the application",
  psp_discovery: "Found in a PSP record",
  manual: "Added by the office",
};

/** One row as the API returns it. */
export const employmentHistorySchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  employer_name: z.string(),
  usdot_number: z.string().nullable(),
  employer_city: z.string().nullable(),
  employer_state: z.string().nullable(),
  employer_phone: z.string().nullable(),
  employer_email: z.string().nullable(),
  position_held: z.string().nullable(),
  started_on: z.string(),
  ended_on: z.string().nullable(),
  dot_regulated: z.boolean(),
  subject_to_fmcsr: z.boolean().nullable(),
  safety_sensitive: z.boolean().nullable(),
  reason_for_leaving: z.string().nullable(),
  inquiry_status: z.string(),
  inquiry_sent_on: z.string().nullable(),
  inquiry_response_on: z.string().nullable(),
  source: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EmploymentHistory = z.infer<typeof employmentHistorySchema>;

/**
 * A USDOT number as FMCSA issues them: digits, up to 8 of them today. Stored as text because a
 * leading zero on a transcribed value is somebody's data, and because arithmetic on an identifier is
 * never wanted. Empty string clears it — a blanked input posts "", the same case `isoDateSchema`
 * exists for.
 */
export const usdotNumberSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
  z.string().regex(/^\d{1,8}$/, "A USDOT number is up to 8 digits").nullish(),
);

const employmentFields = {
  employer_name: z.string().min(1).max(200),
  usdot_number: usdotNumberSchema,
  employer_city: z.string().max(120).nullish(),
  employer_state: z.string().max(40).nullish(),
  employer_phone: z.string().max(40).nullish(),
  employer_email: z.email().max(200).nullish().or(z.literal("").transform(() => null)),
  position_held: z.string().max(120).nullish(),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD"),
  ended_on: isoDateSchema,
  dot_regulated: z.boolean().default(true),
  subject_to_fmcsr: z.boolean().nullish(),
  safety_sensitive: z.boolean().nullish(),
  reason_for_leaving: z.string().max(500).nullish(),
  inquiry_status: z.enum(EMPLOYMENT_INQUIRY_STATUSES).default("pending"),
  inquiry_sent_on: isoDateSchema,
  inquiry_response_on: isoDateSchema,
  source: z.enum(EMPLOYMENT_SOURCES).default("application"),
  notes: z.string().max(2000).nullish(),
};

/** The DB has the same rule as a CHECK; refusing here means a 400 with a sentence instead of a 500. */
const datesOrdered = (v: { started_on?: string; ended_on?: unknown }): boolean =>
  !v.started_on || typeof v.ended_on !== "string" || v.ended_on >= v.started_on;

export const employmentHistoryCreateSchema = z
  .object({ driver_id: z.uuid(), ...employmentFields })
  .strict()
  .refine(datesOrdered, { message: "The end date cannot be before the start date", path: ["ended_on"] });
export type EmploymentHistoryCreate = z.infer<typeof employmentHistoryCreateSchema>;

export const employmentHistoryUpdateSchema = z
  .object({
    ...employmentFields,
    employer_name: employmentFields.employer_name.optional(),
    started_on: employmentFields.started_on.optional(),
    dot_regulated: z.boolean().optional(),
    inquiry_status: z.enum(EMPLOYMENT_INQUIRY_STATUSES).optional(),
    source: z.enum(EMPLOYMENT_SOURCES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Send at least one field to update" })
  .refine(datesOrdered, { message: "The end date cannot be before the start date", path: ["ended_on"] });
export type EmploymentHistoryUpdate = z.infer<typeof employmentHistoryUpdateSchema>;

export const employmentHistoryListResponseSchema = z.object({
  history: z.array(employmentHistorySchema),
});

/** One row of the fleet-level Recruitment table: a driver plus what their file looks like. */
export const recruitmentRosterRowSchema = z.object({
  driver_id: z.uuid(),
  full_name: z.string(),
  status: z.string(),
  hire_date: z.string().nullable(),
  date_of_birth_recorded: z.boolean(),
  employers: z.number(),
  employers_in_window: z.number(),
  gap_days: z.number(),
  inquiries_outstanding: z.number(),
  inquiries_awaiting: z.number(),
});
export type RecruitmentRosterRow = z.infer<typeof recruitmentRosterRowSchema>;

export const recruitmentRosterResponseSchema = z.object({
  drivers: z.array(recruitmentRosterRowSchema),
});
