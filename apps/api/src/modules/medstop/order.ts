import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEDSTOP_ORDER_ROSTER,
  MEDSTOP_ORDER_SERVICE_CODE,
  buildMedstopOrderPayload,
  medstopOrderRefusal,
  medstopRequestIsOpen,
  medstopRequestService,
  type CalendarDay,
  type MedstopOrderInput,
  type MedstopOrderPreview,
  type MedstopOrderRoster,
  type MedstopOrderablePerson,
  type MedstopSite,
} from "@silvicom/shared";
import { readVehiclePositions } from "../samsara/index.js";
import { MedstopClient, MedstopError } from "./client.js";
import { getApiKey, getCredential } from "./credentials.js";
import { readRosterDrivers } from "./sync.js";

/**
 * Ordering a Med-Stop test (MEDSTOP-PLAN.md §7A.4, batch UX3). The drawer previews, the office
 * confirms, and this file places the order — after checking, in this order, everything that would
 * make it wrong:
 *
 *   1. Ordering is switched on for this org (0468, D-MSUX2) and the office contact is set (D-MSUX5).
 *   2. The person is on the Med-Stop roster the reason belongs to (`MEDSTOP_ORDER_ROSTER`: ACTIVE for a
 *      working driver's test, APPLICANT for pre-employment — UX4) and matched by licence or name+DOB to
 *      our driver of the same standing (R3) — a name-only match never orders a test on somebody.
 *   3. A random test comes from an OPEN selection of that same person and test, not yet ordered.
 *   4. Med-Stop holds no unfinished order for that person and test — asked LIVE, because the mirror is
 *      up to an hour old and a second order is a second bill (§7A.4: "refuses a second open order").
 *   5. The collection day is today … +30 (`medstopOrderRefusal`).
 *
 * Preview and place run the same checks and build the payload with the same shared function, so the
 * preview is what is sent. Only placing fetches a request form (Med-Stop issues the request id there)
 * and POSTs it — once (`client.write`, never retried).
 */

export type OrderRefusal = { status: 400 | 404 | 409 | 502; code: string; message: string };
const refuse = (status: OrderRefusal["status"], code: string, message: string): { refusal: OrderRefusal } => ({ refusal: { status, code, message } });

/** A client for this org, or the reason there is none. Ordering needs the connection on AND ordering on. */
export async function orderClient(
  admin: SupabaseClient,
  env: Parameters<typeof getApiKey>[1],
  orgId: string,
): Promise<{ client: MedstopClient; contact: { email: string; phone: string } } | { refusal: OrderRefusal }> {
  const credential = await getCredential(admin, orgId);
  if (!credential?.ordersEnabled)
    return refuse(409, "medstop_orders_off", "Ordering tests is switched off. An admin turns it on under Settings › Med-Stop integration.");
  if (!credential.orderContactEmail || !credential.orderContactPhone)
    return refuse(409, "medstop_contact_missing", "Add the office's e-mail and phone under Settings › Med-Stop integration first — every order carries them instead of the driver's.");
  const key = await getApiKey(admin, env, orgId);
  if (!key) return refuse(409, "medstop_not_connected", "Med-Stop is not connected or is switched off.");
  return {
    client: new MedstopClient({ apiKey: key.apiKey, baseUrl: key.baseUrl, maxRetries: 1 }),
    contact: { email: credential.orderContactEmail, phone: credential.orderContactPhone },
  };
}

/**
 * The people the drawer may order for on one roster: certain match (R3), and OUR record agrees — an
 * active driver for Med-Stop's active roster, an applicant (not archived) for its applicant roster. A
 * person hired here but still an applicant in Med-Stop is on neither list until the two agree.
 */
export async function orderablePeople(admin: SupabaseClient, orgId: string, roster: MedstopOrderRoster = "active"): Promise<MedstopOrderablePerson[]> {
  const { data, error } = await admin
    .from("medstop_employees")
    .select("medstop_id, roster, driver_id, match_rule")
    .eq("org_id", orgId)
    .eq("roster", roster)
    .in("match_rule", ["licence", "name_dob"])
    .not("driver_id", "is", null)
    .limit(1000);
  if (error) throw new Error(`medstop_employees read failed: ${error.message}`);
  const names = new Map((await readRosterDrivers(admin, orgId)).filter((d) => d.status === roster && !d.archived).map((d) => [d.id, d.fullName]));
  // The query's filters, held again here: this list decides who can be ordered a billed test on.
  return (data ?? [])
    .filter((e) => e.roster === roster && (e.match_rule === "licence" || e.match_rule === "name_dob") && names.has(e.driver_id as string))
    .map((e) => ({ medstopId: e.medstop_id as string, driverId: e.driver_id as string, name: names.get(e.driver_id as string)! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The truck a driver is assigned to, and its newest fix — for "find a site near the truck". */
export async function truckPositionOf(admin: SupabaseClient, orgId: string, driverId: string): Promise<{ lat: number; lng: number; where: string | null } | null> {
  const { data, error } = await admin.from("vehicles").select("id").eq("org_id", orgId).eq("assigned_driver_id", driverId).limit(5);
  if (error) throw new Error(`vehicles read failed: ${error.message}`);
  const trucks = new Set((data ?? []).map((v) => v.id as string));
  if (trucks.size === 0) return null;
  const fix = (await readVehiclePositions(admin, orgId)).rows.find((r) => trucks.has(r.vehicle_id));
  return fix ? { lat: fix.lat, lng: fix.lng, where: fix.formatted_location } : null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Collection sites near a ZIP or a point, ranked by Med-Stop (its own sites first, then distance, rating). */
export async function findSites(
  client: MedstopClient,
  q: { service: MedstopOrderInput["service"]; requestDate: string; requestTime: string } & ({ zip: string } | { lat: number; lng: number }),
): Promise<MedstopSite[]> {
  const params = new URLSearchParams({
    service: MEDSTOP_ORDER_SERVICE_CODE[q.service], dotstatus: "Y", observed: "N", requestdate: q.requestDate, requesttime: q.requestTime,
    ...("zip" in q ? { zip: q.zip } : { lat: String(q.lat), lng: String(q.lng) }),
  });
  const body = (await client.read(`/Request/location?${params}`)) as { rows?: unknown[][] } | null;
  return ((body?.rows?.[0] ?? []) as Array<Record<string, unknown>>)
    .filter((r) => text(r.id))
    .map((r) => ({
      id: text(r.id)!, name: text(r.name) ?? "Unnamed site", address: text(r.address), city: text(r.city), state: text(r.state),
      zip: text(r.zip), distance: text(r.text), booked: typeof r.requests === "number" ? r.requests : null,
    }));
}

/** Checks 2–5, and the exact payload. Shared by preview and place, so they cannot disagree. */
export async function prepareOrder(
  admin: SupabaseClient,
  client: MedstopClient,
  contact: { email: string; phone: string },
  orgId: string,
  input: MedstopOrderInput,
  today: CalendarDay,
): Promise<MedstopOrderPreview | { refusal: OrderRefusal }> {
  const day = medstopOrderRefusal(input, today);
  if (day) return refuse(400, "medstop_order_day", day);

  const roster = MEDSTOP_ORDER_ROSTER[input.reason];
  const person = (await orderablePeople(admin, orgId, roster)).find((p) => p.medstopId === input.medstopId);
  if (!person)
    return refuse(
      404,
      "medstop_person_unknown",
      roster === "applicant"
        ? "This applicant is not on Med-Stop's applicant roster with a licence or date-of-birth match, so a pre-employment test cannot be ordered from here. Add them in Med-Stop first."
        : "This person is not on Med-Stop's active roster with a licence or date-of-birth match, so a test cannot be ordered from here.",
    );

  if (input.selectionId) {
    const { data, error } = await admin
      .from("medstop_selections")
      .select("employee_medstop_id, service, status, request_medstop_id")
      .eq("org_id", orgId)
      .eq("medstop_id", input.selectionId)
      .maybeSingle();
    if (error) throw new Error(`medstop_selections read failed: ${error.message}`);
    const s = data as { employee_medstop_id: string | null; service: string | null; status: string | null; request_medstop_id: string | null } | null;
    if (!s || s.employee_medstop_id !== input.medstopId || (s.status ?? "").toUpperCase() !== "OPEN")
      return refuse(409, "medstop_selection_not_open", "That random selection is not open for this person any more.");
    if (s.request_medstop_id) return refuse(409, "medstop_selection_ordered", "A test is already ordered for that random selection.");
    if (medstopRequestService({ service: s.service }) !== input.service)
      return refuse(400, "medstop_selection_service", `That selection is for a${input.service === "drug" ? "n alcohol" : " drug"} test.`);
  }

  try {
    const open = (await client.read(`/Request/for/${encodeURIComponent(input.medstopId)}?page=1&pagesize=100`)) as { rows?: unknown[][] } | null;
    const clash = ((open?.rows?.[0] ?? []) as Array<{ status?: string; service?: string; category?: string }>).find(
      (r) => medstopRequestIsOpen(r.status) && medstopRequestService(r) === input.service,
    );
    if (clash)
      return refuse(409, "medstop_order_open", `Med-Stop already has an unfinished ${input.service} test order for ${person.name}. Finish or cancel that one in Med-Stop first.`);
  } catch (e) {
    return refuse(502, "medstop_unreachable", `Could not ask Med-Stop for open orders, so nothing was ordered: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { payload: buildMedstopOrderPayload(input, contact), person };
}

/** Place the order: re-check, take a request form for its id, POST once. */
export async function placeOrder(
  admin: SupabaseClient,
  client: MedstopClient,
  contact: { email: string; phone: string },
  orgId: string,
  input: MedstopOrderInput,
  today: CalendarDay,
): Promise<({ requestId: string } & MedstopOrderPreview) | { refusal: OrderRefusal }> {
  const prepared = await prepareOrder(admin, client, contact, orgId, input, today);
  if ("refusal" in prepared) return prepared;
  try {
    // Seeded from the selection when there is one — Med-Stop links that selection to the request.
    const form = (await client.read(`/Request/new/${encodeURIComponent(input.selectionId ?? input.medstopId)}`)) as { data?: { id?: unknown; eeid?: unknown } } | null;
    const formId = text(form?.data?.id);
    if (!formId || text(form?.data?.eeid)?.toLowerCase() !== input.medstopId.toLowerCase())
      return refuse(502, "medstop_form", "Med-Stop did not open a request form for this person, so nothing was ordered.");
    const sent = (await client.write("POST", "/Request/new", { id: formId, ...prepared.payload })) as { data?: { id?: unknown } } | null;
    return { requestId: text(sent?.data?.id) ?? formId, ...prepared };
  } catch (e) {
    const ambiguous = e instanceof MedstopError && e.kind === "transport";
    return refuse(
      502,
      ambiguous ? "medstop_order_unknown" : "medstop_order_refused",
      ambiguous
        ? "Med-Stop did not answer, so the order may or may not have been placed. Check Med-Stop before ordering again."
        : `Med-Stop refused the order: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
