import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarDay, MedstopOrderAppointment, MedstopOrderInput, MedstopOrderPlaced, MedstopOrderedCollection } from "@silvicom/shared";
import type { MedstopClient } from "./client.js";
import { mirrorPlacedRequest } from "./syncTests.js";

/**
 * What happens AFTER Place order (MEDSTOP-PLAN.md §7A.21, MSO1 — owner's ruling D-MSO1, 2026-11-03).
 *
 * ── THE ORDER FILLS THE STEP ──────────────────────────────────────────────────────────────────
 * Until MSO1 the office placed the order here, then retyped the site, its address, the deadline and the
 * code into the hiring step's appointment and pressed Send (gap G2: "two systems in one drawer, joined by
 * hand"). Now a pre-employment order reads Med-Stop's own request back (`GET /Request/{id}` — Med-Stop's
 * guide: create, then read the request to confirm) and hands what the applicant needs to recruiting,
 * which owns the appointment (0376) and its one writer. The office then presses ONE button — the
 * appointment's existing Send, through our outbox. Med-Stop still texts nobody (D-MSUX5):
 * `POST /Request/{id}/notify` stays off `MEDSTOP_WRITES`.
 *
 * ── WHY RECRUITING IS HANDED IN, NOT IMPORTED ─────────────────────────────────────────────────
 * `recruiting -> medstop` is an arrow already (the dispatch door reads `medstopViolationOn`), so medstop
 * importing recruiting would be a cycle `lint:boundaries` refuses. The writer arrives as a function from
 * `app.ts`, the composition root, as `orgToday` does. Medstop parses Med-Stop's payload (D-ARC1);
 * recruiting never sees one — it receives a `MedstopOrderedCollection`.
 *
 * ── ⚠ NOTHING HERE MAY FAIL THE ORDER ─────────────────────────────────────────────────────────
 * The POST has already been accepted and billed. An error that escaped this file would answer the office
 * "the order was not placed", and the office would order again — a second bill and a second open order
 * Med-Stop refuses. So every step is caught and reported as what it is (`site_unread`, `not_filled`),
 * and the request id is always returned.
 */

/** Recruiting's half, handed in by `app.ts`: write the applicant's appointment from the order. */
export type FillOrderedAppointment = (
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  collection: MedstopOrderedCollection,
) => Promise<{ appointmentId: string } | { refused: string }>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Med-Stop's request (`Dto.Request`, spec 4.9.31) → what the applicant needs. Null when it names no site
 * or no address: half an appointment is worse than the office typing one.
 *
 * `requestdate` carries the date and time the order was placed with — its exact format is one of
 * §7A.14's six unanswered points until the first real order. A value with no readable time of day falls
 * back to what WE sent, which is the same deadline: the order is placed with it.
 */
export function orderedCollectionOf(
  body: unknown,
  requestId: string,
  sent: Pick<MedstopOrderInput, "requestDate" | "requestTime">,
): MedstopOrderedCollection | null {
  const r = ((body as { data?: unknown } | null)?.data ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  const siteName = text(r.location);
  const street = [text(r.address), text(r.address1)].filter(Boolean).join(", ");
  const place = [text(r.city), [text(r.state), text(r.zip)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const siteAddress = [street, place].filter(Boolean).join(", ");
  if (!siteName || !street) return null;
  const phone = text(r.phone1);
  const ext = text(r.ext1);
  const at = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text(r.requestdate) ?? "");
  return {
    requestId,
    siteName,
    siteAddress,
    sitePhone: phone ? (ext ? `${phone} ext ${ext}` : phone) : null,
    goBy: at ? `${at[1]}T${at[2]}:${at[3]}` : `${sent.requestDate}T${sent.requestTime}`,
    reference: medstopReferenceOf(r),
  };
}

/**
 * What the site asks the applicant for: the request's `code`, with its registration number when that differs.
 * One definition — the appointment is written with it (MSO1) and a closed order's appointment is found by it (MSO2).
 */
export function medstopReferenceOf(r: Record<string, unknown>): string | null {
  const code = text(r.code);
  const registration = text(r.registrationnumber);
  return code && registration && code !== registration ? `${code} (registration ${registration})` : (code ?? registration);
}

export async function followUpPlacedOrder(
  admin: SupabaseClient,
  client: MedstopClient,
  orgId: string,
  userId: string,
  input: MedstopOrderInput,
  placed: { requestId: string; driverId: string },
  today: CalendarDay,
  fill: FillOrderedAppointment,
): Promise<MedstopOrderPlaced> {
  let appointment: MedstopOrderAppointment | null = null;
  if (input.reason === "PRE-EMPLOYMENT") {
    let collection: MedstopOrderedCollection | null = null;
    try {
      collection = orderedCollectionOf(await client.read(`/Request/${encodeURIComponent(placed.requestId)}`), placed.requestId, input);
    } catch (e) {
      console.warn(`[medstop] order ${placed.requestId} placed; its request could not be read back: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!collection) appointment = "site_unread";
    else {
      try {
        const filled = await fill(admin, orgId, userId, placed.driverId, collection);
        appointment = "appointmentId" in filled ? "filled" : "not_filled";
      } catch (e) {
        console.warn(`[medstop] order ${placed.requestId} placed; the appointment was not written: ${e instanceof Error ? e.message : String(e)}`);
        appointment = "not_filled";
      }
    }
  }
  try {
    await mirrorPlacedRequest(admin, client, orgId, placed.requestId, today);
  } catch (e) {
    // The hourly sweep writes the same row; until then the step shows the order a little late.
    console.warn(`[medstop] order ${placed.requestId} placed; not yet mirrored: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { requestId: placed.requestId, appointment };
}
