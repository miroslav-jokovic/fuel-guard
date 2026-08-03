import { z } from "zod";
import { DRIVER_STATUSES } from "./constants.js";
import { DRIVER_TYPES } from "./loadsLifecycle.js";

/**
 * Roster (master data) API contract — `/api/roster/*`.
 *
 * ONE SOURCE OF TRUTH for the admin-owned driver/tractor/trailer records, consumed by the API
 * (request validation), the web app (typed reads) and the driver app. Master Data plan §7.
 *
 * M2 covers DRIVERS ONLY — list, create, and enroll-for-app-access. Tractors, trailers, terminals,
 * endorsements and compliance schemas land with the rest of the CRUD surface in M3.
 *
 * PostgREST returns `numeric` as number|string, so every numeric column uses `z.coerce.number()`;
 * `date` columns arrive as ISO strings and stay `z.string()`.
 */

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
    hire_date: z.string().nullish(),
    home_terminal_id: z.uuid().nullish(),
    cdl_number: z.string().max(60).nullish(),
    cdl_state: z.string().max(10).nullish(),
    cdl_class: z.enum(CDL_CLASSES).nullish(),
    cdl_issued_at: z.string().nullish(),
    cdl_expires_at: z.string().nullish(),
    cdl_restrictions: z.string().max(200).nullish(),
    medical_card_expires_at: z.string().nullish(),
    date_of_birth: z.string().nullish(),
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
