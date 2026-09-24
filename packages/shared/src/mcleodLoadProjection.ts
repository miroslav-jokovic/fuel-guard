import type { LoadStatus } from "./loadsContract.js";

/**
 * McLeod's raw dispatch rows → the product's load (LOADS-MIRROR-PLAN.md LR4; D-LMR2, D-LMR4, D-LMR7,
 * D-LMR8). Pure: no clock, no I/O. The API reads `mcleod_dispatch_*` and writes `loads` /
 * `load_stops`; every rule about what McLeod's words MEAN lives here, where a unit test can pin it and
 * where "re-run the projection" is the whole cost of changing one.
 *
 * Inputs are the raw tables' own column names (0364, 0367) — never a second vocabulary.
 */

export interface RawDispatchMovement {
  company_id: string;
  movement_id: string;
  order_id: string | null;
  movement_status: string | null;
  loaded: string | null;
  dispatcher_user_id: string | null;
  driver_codes: string[];
  tractor_id: string | null;
  trailer_id: string | null;
  trailer_type: string | null;
  commodity: string | null;
  customer_id: string | null;
  weight: number | string | null;
  weight_um: string | null;
  pieces: number | null;
  consignee_refno: string | null;
  move_distance: number | string | null;
  closed_at: string | null;
}

export interface RawDispatchStop {
  stop_id: string;
  movement_sequence: number | null;
  stop_type: string | null;
  status: string | null;
  location_id: string | null;
  location_name: string | null;
  address: string | null;
  city_name: string | null;
  state: string | null;
  zip_code: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  sched_arrive_early: string | null;
  sched_arrive_late: string | null;
  actual_arrival: string | null;
  actual_departure: string | null;
  eta: string | null;
  contact_name: string | null;
  phone: string | null;
  ponum: string | null;
}

export interface ProjectedStop {
  seq: number;
  kind: "pickup" | "dropoff";
  name: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  lat: number | null;
  lon: number | null;
  appointment_start: string | null;
  appointment_end: string | null;
  location_name: string | null;
  location_code: string | null;
  external_status: string | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  eta_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  po_number: string | null;
}

export interface ProjectedLoad {
  external_id: string;
  ref: string;
  status: LoadStatus;
  external_status: string | null;
  equipment: string | null;
  commodity: string | null;
  total_miles: number | null;
  /** McLeod's driver code, resolved to a Silvicom driver by the API (first of a team). */
  driver_code: string | null;
  vehicle_unit: string | null;
  trailer_unit: string | null;
  dispatcher_external_id: string | null;
  customer_code: string | null;
  weight_lbs: number | null;
  pieces: number | null;
  consignee_ref: string | null;
  loaded: boolean | null;
  external_closed_at: string | null;
  stops: ProjectedStop[];
}

export type ProjectionOutcome =
  | { ok: true; load: ProjectedLoad; notes: string[] }
  | { ok: false; movement_id: string; reason: string };

/**
 * McLeod movement status → our status (D-LMR7: status is McLeod's, the Dispatch act is separate).
 *
 *   A (available, not covered)          → pending_approval — the page says "Uncovered"
 *   P (planned/dispatched), none done   → approved         — "Dispatched in McLeod"
 *   P, a stop McLeod marks done ('D')   → in_transit
 *   D (delivered)                       → delivered
 *   V (void)                            → canceled
 *
 * Alex confirmed the four letters on 2026-09-24. Anything else is refused rather than guessed: a new
 * McLeod status should reach a person, not a default.
 */
export function projectMcleodStatus(movementStatus: string | null, stopStatuses: (string | null)[]): LoadStatus | null {
  switch ((movementStatus ?? "").trim()) {
    case "A":
      return "pending_approval";
    case "P":
      return stopStatuses.some((s) => (s ?? "").trim() === "D") ? "in_transit" : "approved";
    case "D":
      return "delivered";
    case "V":
      return "canceled";
    default:
      return null;
  }
}

/**
 * D-LMR8: McLeod's 0 is "no weight entered", not a weightless load. Measured on every 2026 TMS order
 * (12,581): a 0 appears ONLY on delivered orders (8,526), never on A, P or V, and every delivered order
 * older than ~2 weeks is either weighed or 0 — McLeod writes the 0 after delivery. So 0 → null. A unit
 * other than LB (none exist) → null too, until someone rules on a conversion: `weight_lbs` must never
 * hold a number in another unit.
 */
export function projectWeightLbs(weight: number | string | null, unit: string | null): number | null {
  if (weight == null) return null;
  const n = Number(weight);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (unit ?? "").trim().toUpperCase() === "LB" ? n : null;
}

/** McLeod stop types core can draw (D-LM15). VA/VP are interline points, SD/SP split-trailer stops (Alex, 2026-09-24). */
const STOP_KIND: Record<string, "pickup" | "dropoff"> = { PU: "pickup", SO: "dropoff" };

/** Trailer type is where reefer lives at this carrier (D-LM13). */
const EQUIPMENT_LABEL: Record<string, string> = { V: "Van", R: "Reefer" };

const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function stopName(s: RawDispatchStop): string {
  if (s.location_name) return s.location_name;
  if (s.city_name && s.state) return `${s.city_name}, ${s.state}`;
  return s.city_name ?? s.state ?? s.location_id ?? "Stop";
}

export function projectMcleodMovement(m: RawDispatchMovement, stops: RawDispatchStop[]): ProjectionOutcome {
  const status = projectMcleodStatus(m.movement_status, stops.map((s) => s.status));
  if (!m.order_id) return { ok: false, movement_id: m.movement_id, reason: "no order attached" };
  if (!status) return { ok: false, movement_id: m.movement_id, reason: `unknown McLeod status '${m.movement_status ?? ""}'` };

  const notes: string[] = [];
  const ordered = [...stops].sort((a, b) => (a.movement_sequence ?? 0) - (b.movement_sequence ?? 0));
  const projected: ProjectedStop[] = [];
  ordered.forEach((s, i) => {
    const kind = STOP_KIND[(s.stop_type ?? "").trim()];
    if (!kind) {
      notes.push(`movement ${m.movement_id}: stop ${s.movement_sequence ?? i + 1} type '${s.stop_type ?? ""}' kept in raw, not drawn`);
      return;
    }
    projected.push({
      // McLeod's own sequence, so a stop keeps its number across syncs even when a VA sits between.
      seq: s.movement_sequence ?? i + 1,
      kind,
      name: stopName(s),
      address_line: s.address,
      city: s.city_name,
      state: s.state,
      postal_code: s.zip_code,
      lat: num(s.latitude),
      lon: num(s.longitude),
      appointment_start: s.sched_arrive_early,
      appointment_end: s.sched_arrive_late,
      location_name: s.location_name,
      location_code: s.location_id,
      external_status: s.status,
      actual_arrival_at: s.actual_arrival,
      actual_departure_at: s.actual_departure,
      eta_at: s.eta,
      contact_name: s.contact_name,
      contact_phone: s.phone,
      po_number: s.ponum,
    });
  });
  if (m.driver_codes.length > 1) notes.push(`movement ${m.movement_id}: team ${m.driver_codes.join(", ")} — ${m.driver_codes[0]} shown`);

  const trailerType = (m.trailer_type ?? "").trim();
  return {
    ok: true,
    notes,
    load: {
      external_id: `${m.company_id}:${m.movement_id}`,
      ref: m.order_id,
      status,
      external_status: m.movement_status,
      equipment: trailerType ? (EQUIPMENT_LABEL[trailerType] ?? trailerType) : null,
      commodity: m.commodity,
      total_miles: num(m.move_distance),
      driver_code: m.driver_codes[0] ?? null,
      vehicle_unit: m.tractor_id,
      trailer_unit: m.trailer_id,
      dispatcher_external_id: m.dispatcher_user_id,
      customer_code: m.customer_id,
      weight_lbs: projectWeightLbs(m.weight, m.weight_um),
      // Same reading as weight (D-LMR8): McLeod's 0 pieces is "not entered" — the one zero-weight order
      // on the 2026-09-24 board carried 0 pieces too, and zero-weight orders carry pieces on 2 of 8,526.
      pieces: m.pieces != null && m.pieces > 0 ? m.pieces : null,
      consignee_ref: m.consignee_refno,
      loaded: m.loaded === "L" ? true : m.loaded === "E" ? false : null,
      external_closed_at: m.closed_at,
      stops: projected,
    },
  };
}
