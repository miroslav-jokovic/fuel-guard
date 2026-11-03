import type { SupabaseClient } from "@supabase/supabase-js";
import {
  medstopCloseComment,
  medstopRequestIsOpen,
  shiftDay,
  type CalendarDay,
  type MedstopCloseInput,
  type MedstopClosePreview,
  type MedstopClosed,
} from "@silvicom/shared";
import { MedstopError, type MedstopClient } from "./client.js";
import { orderablePeople, type OrderRefusal } from "./order.js";
import { medstopReferenceOf } from "./orderFollowUp.js";
import { mirrorRequest } from "./syncTests.js";

/**
 * Closing an open order from the hiring step (MEDSTOP-PLAN.md §7A.21, MSO2 — owner's ruling D-MSO3,
 * 2026-11-03): "Didn't go — mark no-show" and "Cancel order". One order in three is cancelled and 22 of 99
 * applicants were re-ordered (§7A.21), and Med-Stop refuses a second open order for the same test — so until
 * an order is closed, the step cannot order again, and closing meant leaving for Med-Stop's portal.
 *
 * Med-Stop's own guide: read before write. So preview and close run the same reads, in this order:
 *
 *   1. The request is in our mirror for this org, for a person we would order for (certain match, R3) —
 *      the office cannot close a request on somebody it cannot see.
 *   2. `GET /Request/{id}` answers it OPEN now — asked live, because the mirror is up to an hour old and a
 *      collected donor's request must not be marked a no-show.
 *   3. `GET /Request/{id}/status` — the close-out form — names this same request.
 *
 * The POST is that form as Med-Stop gave it, with only three things set: `status` (NO SHOW | CANCELED, list
 * STATUSREQUESTCLOSE), `comment` (fixed words, shown in the preview) and `refusal: "N"`. Sent ONCE, never
 * retried: an unanswered close is reported as "check Med-Stop", like an unanswered order.
 *
 * Measured 2026-11-03 on a real open request (GET only): the form is `id, employee, service, location,
 * requestdate, test, testlocation, status, comment, refusal, notification`, the last four empty.
 */

/** Recruiting's half, handed in by `app.ts` (as MSO1's writer is): retire the appointment the order filled. */
export type ReleaseOrderedAppointment = (admin: SupabaseClient, orgId: string, driverId: string, reference: string) => Promise<number>;

const refuse = (status: OrderRefusal["status"], code: string, message: string): { refusal: OrderRefusal } => ({ refusal: { status, code, message } });
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

interface Prepared {
  preview: MedstopClosePreview;
  form: Record<string, unknown>;
  request: Record<string, unknown>;
  driverId: string;
  medstopId: string;
}

export async function prepareClose(
  admin: SupabaseClient,
  client: MedstopClient,
  orgId: string,
  requestId: string,
  input: MedstopCloseInput,
): Promise<Prepared | { refusal: OrderRefusal }> {
  const { data, error } = await admin
    .from("medstop_requests")
    .select("medstop_id, employee_medstop_id")
    .eq("org_id", orgId)
    .eq("medstop_id", requestId)
    .maybeSingle();
  if (error) throw new Error(`medstop_requests read failed: ${error.message}`);
  const row = data as { medstop_id: string; employee_medstop_id: string | null } | null;
  const people = [...(await orderablePeople(admin, orgId, "applicant")), ...(await orderablePeople(admin, orgId, "active"))];
  const person = row ? people.find((p) => p.medstopId === row.employee_medstop_id) : undefined;
  if (!row || !person) return refuse(404, "medstop_request_unknown", "That order is not one this office can close from here. Close it in Med-Stop.");

  let request: Record<string, unknown> | null;
  let form: Record<string, unknown> | null;
  try {
    request = ((await client.read(`/Request/${encodeURIComponent(requestId)}`)) as { data?: Record<string, unknown> } | null)?.data ?? null;
    if (!request || text(request.id)?.toLowerCase() !== requestId.toLowerCase())
      return refuse(404, "medstop_request_unknown", "Med-Stop does not have that order any more.");
    if (!medstopRequestIsOpen(text(request.status)))
      return refuse(409, "medstop_request_closed", `Med-Stop already has this order as ${(text(request.status) ?? "closed").toLowerCase()}, so there is nothing to close.`);
    form = ((await client.read(`/Request/${encodeURIComponent(requestId)}/status`)) as { data?: Record<string, unknown> } | null)?.data ?? null;
  } catch (e) {
    return refuse(502, "medstop_unreachable", `Could not read the order in Med-Stop, so nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!form || text(form.id)?.toLowerCase() !== requestId.toLowerCase())
    return refuse(502, "medstop_form", "Med-Stop did not open the close-out form for this order, so nothing was changed.");

  const at = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text(request.requestdate) ?? "");
  return {
    preview: {
      requestId,
      status: input.status,
      comment: medstopCloseComment(input),
      person: person.name,
      site: text(request.location),
      goBy: at ? `${at[1]}T${at[2]}` : null,
    },
    form,
    request,
    driverId: person.driverId,
    medstopId: person.medstopId,
  };
}

/** Exactly what is POSTed: Med-Stop's own form, with the outcome, the comment and "not a refusal" set. */
export const closePayload = (form: Record<string, unknown>, preview: MedstopClosePreview): Record<string, unknown> => ({
  ...form,
  status: preview.status,
  comment: preview.comment,
  refusal: "N",
});

export async function closeOrder(
  admin: SupabaseClient,
  client: MedstopClient,
  orgId: string,
  requestId: string,
  input: MedstopCloseInput,
  today: CalendarDay,
  release: ReleaseOrderedAppointment,
): Promise<(MedstopClosed & { driverId: string }) | { refusal: OrderRefusal }> {
  const prepared = await prepareClose(admin, client, orgId, requestId, input);
  if ("refusal" in prepared) return prepared;
  try {
    await client.write("POST", `/Request/${encodeURIComponent(requestId)}/status`, closePayload(prepared.form, prepared.preview));
  } catch (e) {
    const ambiguous = e instanceof MedstopError && e.kind === "transport";
    return refuse(
      502,
      ambiguous ? "medstop_close_unknown" : "medstop_close_refused",
      ambiguous
        ? "Med-Stop did not answer, so the order may or may not be closed. Check Med-Stop before ordering again."
        : `Med-Stop refused to close the order: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ⚠ Closed and done from here; nothing below may report it as not closed (orderFollowUp.ts's rule).
  const reference = medstopReferenceOf(prepared.request);
  if (reference) {
    try {
      await release(admin, orgId, prepared.driverId, reference);
    } catch (e) {
      console.warn(`[medstop] order ${requestId} closed; its appointment was not retired: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    const day = text(prepared.request.requestdate)?.slice(0, 10);
    await mirrorRequest(admin, client, orgId, requestId, /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? shiftDay(day!, -1) : shiftDay(today, -30));
  } catch (e) {
    console.warn(`[medstop] order ${requestId} closed; not yet mirrored: ${e instanceof Error ? e.message : String(e)}`);
  }
  const zip = /^\d{5}/.exec(text(prepared.request.zip) ?? "")?.[0] ?? null;
  return {
    requestId,
    status: input.status,
    driverId: prepared.driverId,
    reorder: { medstopId: prepared.medstopId, zip, locationId: text(prepared.request.locationid) },
  };
}
