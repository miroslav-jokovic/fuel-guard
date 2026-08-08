import { z } from "zod";
import { DRIVER_STATUSES } from "./constants.js";
import { DRIVER_TYPES } from "./loadsLifecycle.js";

/**
 * Roster (master data) API contract — `/api/roster/*`.
 *
 * ONE SOURCE OF TRUTH for the admin-owned driver/tractor/trailer records, consumed by the API
 * (request validation), the web app (typed reads) and the driver app. Master Data plan §7.
 *
 * DRIVERS ONLY — list, detail, create, update, and enroll-for-app-access. Tractors, trailers and
 * terminals land with the rest of the CRUD surface.
 *
 * PostgREST returns `numeric` as number|string, so every numeric column uses `z.coerce.number()`;
 * `date` columns arrive as ISO strings and stay `z.string()`.
 */

/**
 * A `date` column, as a browser date input actually behaves.
 *
 * Two things this catches that `z.string()` did not. A cleared `<input type="date">` posts `""`, and
 * `''::date` is a Postgres error — so the endpoint used to answer a blank field with a 500. And a
 * mistyped expiry reached the database as garbage rather than a 400. Both matter more here than
 * anywhere else in the product: `cdl_expires_at` and `medical_card_expires_at` are what the
 * qualification gate reads, and a driver's CDL expiry silently failing to save is a compliance
 * incident, not a UI annoyance.
 */
export const isoDateSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD").nullish(),
);

// ── vocabularies ──────────────────────────────────────────────────────────────

/**
 * Statuses and driver types come from the EXISTING single sources of truth (`constants.ts`,
 * `loadsLifecycle.ts`) rather than being redeclared here — a second copy is how the roster form and
 * the dispatch acceptance rules drift apart. `DRIVER_STATUSES` was widened to the canonical four
 * (active | inactive | on_leave | terminated) for master data; `auth_driver_id()` (0083) resolves
 * only 'active', so a driver on leave keeps their record but stops resolving in the driver app.
 */
export const driverStatusSchema = z.enum(DRIVER_STATUSES);

/**
 * Who owns this record's identity fields. 'samsara' = the telematics sync created it and may keep
 * updating name/phone; 'manual' = an admin typed it and the sync must not clobber it (plan §4).
 */
export const IDENTITY_SOURCES = ["samsara", "manual"] as const;
export const identitySourceSchema = z.enum(IDENTITY_SOURCES);
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

export const driverTypeSchema = z.enum(DRIVER_TYPES);

export const CDL_CLASSES = ["A", "B", "C"] as const;
export const PAY_TYPES = ["mileage", "hourly", "percentage", "salary"] as const;

/** H hazmat · N tank · X hazmat+tank · T doubles/triples · P passenger · S school bus. */
export const ENDORSEMENT_CODES = ["H", "N", "X", "T", "P", "S"] as const;
export const endorsementCodeSchema = z.enum(ENDORSEMENT_CODES);
export type EndorsementCode = (typeof ENDORSEMENT_CODES)[number];

// ── list ──────────────────────────────────────────────────────────────────────

/**
 * The roster table row. Intentionally narrow: the columns a manager scans a 100-row list by.
 * The full profile is the M3 detail endpoint, not this.
 */
export const driverListItemSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  status: z.string(),
  employee_id: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  driver_type: z.string().nullable(),
  identity_source: z.string(),
  /** True once an invite bound a login to this row — the "has the app" column. */
  app_access_enabled: z.boolean(),
  /** Non-null = a login is linked. The UI shows presence only; the id itself is not rendered. */
  user_id: z.uuid().nullable(),
  cdl_number: z.string().nullable(),
  cdl_expires_at: z.string().nullable(),
  medical_card_expires_at: z.string().nullable(),
  home_terminal_id: z.uuid().nullable(),
  hire_date: z.string().nullable(),
  created_at: z.string(),
});
export type DriverListItem = z.infer<typeof driverListItemSchema>;

export const driverListResponseSchema = z.object({
  drivers: z.array(driverListItemSchema),
});
export type DriverListResponse = z.infer<typeof driverListResponseSchema>;

// ── create ────────────────────────────────────────────────────────────────────

/**
 * `POST /api/roster/drivers`. Either `full_name` OR first+last is required — the API derives
 * `full_name` when only the structured parts are given, because `full_name` is NOT NULL and is what
 * every existing surface (and the Samsara matcher) reads.
 *
 * `identity_source` is NOT accepted from the client: this endpoint always writes 'manual'.
 */
export const driverCreateSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    first_name: z.string().max(100).nullish(),
    middle_name: z.string().max(100).nullish(),
    last_name: z.string().max(100).nullish(),
    employee_id: z.string().max(60).nullish(),
    email: z.email().max(200).nullish(),
    phone: z.string().max(40).nullish(),
    phone_alt: z.string().max(40).nullish(),
    status: driverStatusSchema.default("active"),
    driver_type: driverTypeSchema.nullish(),
    hire_date: isoDateSchema,
    home_terminal_id: z.uuid().nullish(),
    cdl_number: z.string().max(60).nullish(),
    cdl_state: z.string().max(10).nullish(),
    cdl_class: z.enum(CDL_CLASSES).nullish(),
    cdl_issued_at: isoDateSchema,
    cdl_expires_at: isoDateSchema,
    cdl_restrictions: z.string().max(200).nullish(),
    medical_card_expires_at: isoDateSchema,
    date_of_birth: isoDateSchema,
    pay_type: z.enum(PAY_TYPES).nullish(),
    pay_rate: z.coerce.number().nonnegative().max(1_000_000).nullish(),
    per_diem: z.boolean().nullish(),
    settlement_company: z.string().max(200).nullish(),
    eld_id: z.string().max(120).nullish(),
  })
  .refine(
    (v) => Boolean(v.full_name?.trim()) || Boolean(v.first_name?.trim() && v.last_name?.trim()),
    {
      message: "Provide full_name, or both first_name and last_name",
      path: ["full_name"],
    },
  );
export type DriverCreateRequest = z.infer<typeof driverCreateSchema>;

export const driverCreateResponseSchema = z.object({
  driver: driverListItemSchema,
});
export type DriverCreateResponse = z.infer<typeof driverCreateResponseSchema>;

// ── detail + update ───────────────────────────────────────────────────────────

/**
 * The full profile behind one roster row — everything 0098 turned the telematics stub into.
 *
 * `samsara_driver_id` is exposed deliberately: paired with `identity_source` it is the answer to
 * "why did this name change back", which is otherwise unanswerable from the UI.
 */
export const driverDetailSchema = driverListItemSchema.extend({
  first_name: z.string().nullable(),
  middle_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone_alt: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  termination_date: z.string().nullable(),
  address_line1: z.string().nullable(),
  address_line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  emergency_contact_name: z.string().nullable(),
  emergency_contact_phone: z.string().nullable(),
  emergency_contact_relation: z.string().nullable(),
  cdl_state: z.string().nullable(),
  cdl_class: z.string().nullable(),
  cdl_issued_at: z.string().nullable(),
  cdl_restrictions: z.string().nullable(),
  medical_examiner_name: z.string().nullable(),
  medical_registry_number: z.string().nullable(),
  pay_type: z.string().nullable(),
  pay_rate: z.coerce.number().nullable(),
  per_diem: z.boolean().nullable(),
  settlement_company: z.string().nullable(),
  eld_id: z.string().nullable(),
  samsara_driver_id: z.string().nullable(),
  updated_at: z.string(),
});
export type DriverDetail = z.infer<typeof driverDetailSchema>;

export const driverDetailResponseSchema = z.object({ driver: driverDetailSchema });
export type DriverDetailResponse = z.infer<typeof driverDetailResponseSchema>;

/**
 * `PATCH /api/roster/drivers/:id` — the master-data edit surface.
 *
 * STRICT on purpose. The columns absent here are absent because something else owns them, and an
 * unknown key is a 400 rather than a silent no-op: `org_id` and `id` (identity of the row),
 * `identity_source` (derived from what you edited — see resolveDriverUpdate), `user_id` and
 * `app_access_enabled` (owned by the invite/accept flow), `app_username` (the credentials router),
 * `samsara_driver_id` / `samsara_username` / `efs_driver_id` (provenance the syncs own), and the
 * `current_hos_*` columns (telematics). Sending one of those and having it quietly ignored is worse
 * than being told no.
 */
export const driverUpdateSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    first_name: z.string().max(100).nullish(),
    middle_name: z.string().max(100).nullish(),
    last_name: z.string().max(100).nullish(),
    employee_id: z.string().max(60).nullish(),
    email: z.email().max(200).nullish(),
    phone: z.string().max(40).nullish(),
    phone_alt: z.string().max(40).nullish(),
    status: driverStatusSchema.optional(),
    driver_type: driverTypeSchema.nullish(),
    hire_date: isoDateSchema,
    termination_date: isoDateSchema,
    home_terminal_id: z.uuid().nullish(),
    date_of_birth: isoDateSchema,
    address_line1: z.string().max(200).nullish(),
    address_line2: z.string().max(200).nullish(),
    city: z.string().max(120).nullish(),
    state: z.string().max(40).nullish(),
    postal_code: z.string().max(20).nullish(),
    emergency_contact_name: z.string().max(200).nullish(),
    emergency_contact_phone: z.string().max(40).nullish(),
    emergency_contact_relation: z.string().max(60).nullish(),
    cdl_number: z.string().max(60).nullish(),
    cdl_state: z.string().max(10).nullish(),
    cdl_class: z.enum(CDL_CLASSES).nullish(),
    cdl_issued_at: isoDateSchema,
    cdl_expires_at: isoDateSchema,
    cdl_restrictions: z.string().max(200).nullish(),
    medical_card_expires_at: isoDateSchema,
    medical_examiner_name: z.string().max(200).nullish(),
    medical_registry_number: z.string().max(60).nullish(),
    pay_type: z.enum(PAY_TYPES).nullish(),
    pay_rate: z.coerce.number().nonnegative().max(1_000_000).nullish(),
    per_diem: z.boolean().nullish(),
    settlement_company: z.string().max(200).nullish(),
    eld_id: z.string().max(120).nullish(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Send at least one field to update" });
export type DriverUpdateRequest = z.infer<typeof driverUpdateSchema>;

/**
 * The fields the Samsara sync also writes. Editing any of them is the admin CLAIMING this row from
 * telematics — see resolveDriverUpdate. `samsara_username` is on the sync's list too but is not
 * editable here, so it is not on this one.
 */
export const DRIVER_IDENTITY_FIELDS = [
  "full_name", "first_name", "middle_name", "last_name", "phone",
] as const;

/** The subset of the current row resolveDriverUpdate needs to decide what an edit means. */
export interface DriverUpdateContext {
  identity_source: string;
  termination_date: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
}

export interface ResolvedDriverUpdate {
  /** The column patch to send to the database. */
  patch: Record<string, unknown>;
  /** The edit claimed a telematics-owned row for the office (identity_source samsara → manual). */
  claimedFromTelematics: boolean;
  /** A termination date the caller did not supply was stamped, because the retention clock needs one. */
  stampedTerminationDate: boolean;
  /** `full_name` was recomputed from the structured parts because the caller changed them. */
  derivedFullName: boolean;
}

/**
 * Turn a validated PATCH into the actual column patch. Pure, so the three rules below are testable
 * without a database — and they are the rules, not incidental route code.
 *
 * 1. **Editing identity claims the row.** The Samsara sync refreshes `full_name` and `phone` on every
 *    run for rows it owns. An admin who corrects a misspelled name on a telematics-sourced row and
 *    watches it revert the next morning has been told, correctly, that the product does not work. So
 *    an identity edit flips `identity_source` to 'manual', which is the flag the sync honours. Only
 *    an identity edit: correcting someone's pay rate should not sever their name refresh.
 *
 * 2. **Changing the parts changes the whole.** `full_name` is NOT NULL and is what the sync matcher
 *    and every existing surface read. If the caller edits first/middle/last without sending
 *    `full_name`, it is recomputed from the merged result — never the reverse, per 0098.
 *
 * 3. **Terminating starts a clock.** §391.51(c) retains the qualification file for three years from
 *    the end of employment, so a termination with no date is a retention rule with no start. If the
 *    caller sets `status: 'terminated'` without a date and the row has none, today's date is stamped.
 *    An existing date is never overwritten — a correction to the status is not a correction to when.
 */
export function resolveDriverUpdate(
  req: DriverUpdateRequest, current: DriverUpdateContext, today: string,
): ResolvedDriverUpdate {
  const patch: Record<string, unknown> = { ...req };
  const touched = new Set(Object.keys(req));

  const editedIdentity = DRIVER_IDENTITY_FIELDS.some((f) => touched.has(f));
  const claimedFromTelematics = editedIdentity && current.identity_source !== "manual";
  if (claimedFromTelematics) patch.identity_source = "manual";

  const editedParts = touched.has("first_name") || touched.has("middle_name") || touched.has("last_name");
  let derivedFullName = false;
  if (editedParts && !touched.has("full_name")) {
    const merged = deriveFullName({
      first_name: touched.has("first_name") ? req.first_name : current.first_name,
      middle_name: touched.has("middle_name") ? req.middle_name : current.middle_name,
      last_name: touched.has("last_name") ? req.last_name : current.last_name,
    });
    // Never write an empty `full_name` — the column is NOT NULL and clearing every part is an edit
    // to the parts, not a request to erase the person's name.
    if (merged.length > 0) {
      patch.full_name = merged;
      derivedFullName = true;
    }
  }

  const stampedTerminationDate =
    req.status === "terminated" && !touched.has("termination_date") && current.termination_date == null;
  if (stampedTerminationDate) patch.termination_date = today;

  return { patch, claimedFromTelematics, stampedTerminationDate, derivedFullName };
}

// ── enroll for app access ─────────────────────────────────────────────────────

/** `POST /api/roster/drivers/:id/invite` — invite THIS roster row to the driver app (plan §3.1). */
export const driverInviteSchema = z.object({
  email: z.email().max(200),
});
export type DriverInviteRequest = z.infer<typeof driverInviteSchema>;

/**
 * `link` is always returned when it could be generated, even if the email failed to send — the same
 * contract `/api/invites` uses, so an admin can copy the link when mail is misconfigured.
 */
export const driverInviteResponseSchema = z.object({
  ok: z.literal(true),
  emailSent: z.boolean(),
  reason: z.string().nullable(),
  link: z.string().nullable(),
});
export type DriverInviteResponse = z.infer<typeof driverInviteResponseSchema>;

// ── name derivation (pure — shared by API create/update and any UI preview) ────

/**
 * Build `full_name` from structured parts. Used when an admin fills first/last but not full_name.
 * Kept here (not in the route) so the API and the web form agree on the result, and so it is unit
 * testable without a DB.
 */
export function deriveFullName(parts: {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
}): string {
  return [parts.first_name, parts.middle_name, parts.last_name]
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" ");
}
