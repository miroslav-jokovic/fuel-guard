import { z } from "zod";
import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type { UserRole } from "./constants.js";

/**
 * Ordering a Med-Stop test from the product (MEDSTOP-PLAN.md §7A.4, batch UX3) — the contract and the
 * one function that builds what is sent. Every order is billed to the carrier and places a real
 * electronic collection order (there is no Med-Stop test host, Q-MS2), so the drawer shows the
 * payload BEFORE it is sent and the api rebuilds it from the same inputs with this same function:
 * the preview cannot describe one order and the confirm place another.
 *
 * Values are Med-Stop's own list codes, read live 2026-10-13 (`/List/REASONTEST`, `CATEGORYSERVICE`,
 * `CATEGORYNOTIFY`, `CATEGORYPAYMENTTEST`).
 */



/**
 * Who may ORDER a Med-Stop test (§7A.10, owner answer 1, D-MSUX1): the safety manager, an admin and
 * the recruiter, for every reason. Ordering is not reading — the recruiter still never sees a result
 * (`canReadTestingRecords` in auth.ts is unchanged). The api's route guard and the web's buttons both
 * read this list; neither types it again.
 */
export const MEDSTOP_ORDER_ROLES = ["admin", "safety_manager", "recruiter"] as const satisfies readonly UserRole[];
export const canOrderDrugTests = (role: UserRole | null | undefined): boolean =>
  role != null && (MEDSTOP_ORDER_ROLES as readonly string[]).includes(role);

export type MedstopOrderService = "drug" | "alcohol";
export const MEDSTOP_ORDER_SERVICE_CODE: Record<MedstopOrderService, "TD" | "TA"> = { drug: "TD", alcohol: "TA" };

/**
 * The reasons this drawer orders. Not every Med-Stop reason:
 * - RETURN TO DUTY and FOLLOW-UP must be OBSERVED collections (§40.67(b)), and an observer is
 *   gender-matched — we do not hold the donor's gender until Part 1 asks it (D-MSUX3, batch UX5).
 * - PRE-EMPLOYMENT is ordered from the hiring step for an applicant (batch UX4); the people this
 *   drawer offers are working drivers.
 * - EXAMINATION / RECERTIFICATION are medical exams (TM), not drug or alcohol tests.
 * - RANDOM is offered only FROM a random selection: a random test with no selection behind it is not
 *   a random test in the §382.305 sense, and the selection is what Med-Stop links the order to.
 */
export const MEDSTOP_ORDER_REASONS = ["RANDOM", "POST-ACCIDENT", "REASONABLE SUSPICION"] as const;
export type MedstopOrderReason = (typeof MEDSTOP_ORDER_REASONS)[number];
export const MEDSTOP_ORDER_REASON_LABEL: Record<MedstopOrderReason, string> = {
  RANDOM: "Random selection",
  "POST-ACCIDENT": "Post-accident",
  "REASONABLE SUSPICION": "Reasonable suspicion",
};

/** How the EMPLOYER told the driver to go (Med-Stop's `notifyby`). Med-Stop itself tells nobody (D-MSUX5). */
export const MEDSTOP_NOTIFY_BY = ["DIRECT COMMUNICATION", "PHONE CALL", "SIGNED TEST NOTIFICATION FORM", "OTHER"] as const;
export type MedstopNotifyBy = (typeof MEDSTOP_NOTIFY_BY)[number];
export const MEDSTOP_NOTIFY_BY_LABEL: Record<MedstopNotifyBy, string> = {
  "DIRECT COMMUNICATION": "Told in person",
  "PHONE CALL": "Phone call",
  "SIGNED TEST NOTIFICATION FORM": "Signed notification form",
  OTHER: "Other",
};

/** A collection date this far ahead at most — Med-Stop's site search answers 30 days (spec, `d+30`). */
export const MEDSTOP_ORDER_MAX_DAYS_AHEAD = 30;

export const medstopOrderInputSchema = z
  .object({
    medstopId: z.string().trim().min(1),
    service: z.enum(["drug", "alcohol"]),
    reason: z.enum(MEDSTOP_ORDER_REASONS),
    selectionId: z.string().trim().min(1).optional(),
    locationId: z.string().trim().min(1),
    requestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    requestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    notifyBy: z.enum(MEDSTOP_NOTIFY_BY),
  })
  .strict()
  .refine((o) => (o.reason === "RANDOM") === (o.selectionId !== undefined), {
    message: "A random test is ordered from its selection, and only a random test carries one.",
    path: ["selectionId"],
  });
export type MedstopOrderInput = z.infer<typeof medstopOrderInputSchema>;

/** The office contact every order carries in place of the driver's (D-MSUX5, 0468). */
export interface MedstopOrderContact {
  email: string;
  phone: string;
}

/** Exactly what is POSTed to `/Request/new`, less the form id Med-Stop issues at send time. */
export interface MedstopOrderPayload {
  eeid: string;
  category: "TD" | "TA";
  reason: MedstopOrderReason;
  dotstatus: "Y";
  observed: "N";
  requestdate: string;
  requesttime: string;
  locationid: string;
  payment: "EMPLOYER";
  notifyby: MedstopNotifyBy;
  sendsms: "N";
  sendemail: "N";
  tosms: string;
  toemail: string;
}

/**
 * The order, as sent. Fixed parts and why:
 * - `dotstatus: "Y"` — every person this drawer offers is a DOT driver (170/170 on 2026-10-13).
 * - `observed: "N"` — the observed reasons are not offered (above).
 * - `payment: "EMPLOYER"` — "company Med-Stop credit"; every order in the last 12 months was (MS0).
 * - `sendsms`/`sendemail` "N", and `tosms`/`toemail` the OFFICE's: Med-Stop's form arrives with the
 *   driver's phone already in `tosms` (measured 2026-10-13), so it is overwritten, never left.
 */
export function buildMedstopOrderPayload(input: MedstopOrderInput, contact: MedstopOrderContact): MedstopOrderPayload {
  return {
    eeid: input.medstopId,
    category: MEDSTOP_ORDER_SERVICE_CODE[input.service],
    reason: input.reason,
    dotstatus: "Y",
    observed: "N",
    requestdate: input.requestDate,
    requesttime: input.requestTime,
    locationid: input.locationId,
    payment: "EMPLOYER",
    notifyby: input.notifyBy,
    sendsms: "N",
    sendemail: "N",
    tosms: contact.phone,
    toemail: contact.email,
  };
}

/** Med-Stop's request statuses that are not finished — a second order beside one of these is refused. */
const OPEN_REQUEST_STATUSES: ReadonlySet<string> = new Set(["PROCESSING", "OPEN", "ACTIVE", "PREPARE", "TESTING"]);
export const medstopRequestIsOpen = (status: string | null | undefined): boolean =>
  OPEN_REQUEST_STATUSES.has((status ?? "").toUpperCase());

/** Med-Stop names a request's test either by code (TD) or by label (DRUG TEST); both mean the same. */
export function medstopRequestService(row: { service?: string | null; category?: string | null }): MedstopOrderService | null {
  const v = `${row.service ?? ""} ${row.category ?? ""}`.toUpperCase();
  if (/\bTD\b|DRUG/.test(v)) return "drug";
  if (/\bTA\b|ALCOHOL/.test(v)) return "alcohol";
  return null;
}

/** Why an order cannot be placed, in the office's words; empty = it may go. Checked again by the api. */
export function medstopOrderRefusal(input: MedstopOrderInput, today: CalendarDay): string | null {
  if (input.requestDate < today) return "Pick today or a later day for the collection.";
  if (input.requestDate > shiftDay(today, MEDSTOP_ORDER_MAX_DAYS_AHEAD))
    return `Pick a collection day within ${MEDSTOP_ORDER_MAX_DAYS_AHEAD} days.`;
  return null;
}

/** One collection site, as `/Request/location` ranks them (Med-Stop sites first, then distance and rating). */
export interface MedstopSite {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Med-Stop's own distance text, e.g. "3.2 mi". */
  distance: string | null;
  /** Requests already booked in the chosen slot. */
  booked: number | null;
}

/** A person the drawer may order for: on Med-Stop's active roster, matched by licence or name+DOB (R3). */
export interface MedstopOrderablePerson {
  medstopId: string;
  driverId: string;
  name: string;
}

export interface MedstopOrderPreview {
  payload: MedstopOrderPayload;
  person: MedstopOrderablePerson;
}

export interface MedstopOrderPlaced {
  requestId: string;
}
