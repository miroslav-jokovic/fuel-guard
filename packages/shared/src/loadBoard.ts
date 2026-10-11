import { DRIVER_DONE_STOP_STATUSES, type LoadStatus, type StopStatus } from "./loadsContract.js";
import { LOAD_STATUS_LABELS } from "./loadsLifecycle.js";
import { mcleodStopDeparted } from "./mcleodLoadProjection.js";

/**
 * How the Loads board reads one load (LOADS-MIRROR-PLAN.md LR7) — the queue it sits in, the word it
 * wears, what McLeod itself called it, and the stops and type the table draws. Pure, so the board and
 * the load page cannot word the same load two ways.
 *
 * ── WHY THE LABEL IS NOT JUST `LOAD_STATUS_LABELS[status]` ──────────────────────────────────────
 * `loads.status` is McLeod's, projected (D-LMR7, LR4b): `A` → pending_approval, `P` with nothing done →
 * approved, `P` under way → in_transit, `D` → delivered, `V` → canceled. The status vocabulary was
 * written for the approval chain LR6 removed, so its words ("Available", "Approved") describe the
 * pipeline, not the truck. Two findings from the live board on 2026-09-24 decide the words here:
 *
 *   1. Every `P` on the board already had its first stop done — at this carrier `P` means under way,
 *      so `in_transit` reads "In transit" and the rare `P` with nothing done reads "Planned".
 *   2. 26 of the 47 `A` movements already carried a driver AND a truck, only no dispatcher. Calling
 *      those "Uncovered" would send a dispatcher looking for a driver the load already has. So an `A`
 *      with both is "Planned" and sits with the working loads; an `A` missing either is "Uncovered",
 *      on its own tab (Q-LMR3), and never on the map (D-MCC12 — the map reads status, not this).
 *
 * The status itself is never rewritten: this is a reading of it, and McLeod's own code travels in the
 * tooltip (`mcleodWords`) so a dispatcher can match the board to McLeod's screen.
 */

/**
 * ── ACTIVE WAS SPLIT IN TWO (DISPATCH-BOARD-PLAN §5.3, DB5b, 2026-10-10) ─────────────────────────
 * One "Active" queue held both the loads moving and the loads planned behind them, so an office reader
 * looking for an order had to read every badge to know which it was. The queues now say it: In transit
 * (a stop is behind the truck) and Upcoming (planned, including a truck's pre-assigned next load —
 * 8 trucks had one on 2026-10-09). The live view of the trucks themselves is the Dispatch board's.
 */
export const LOAD_BOARD_QUEUES = ["in_transit", "upcoming", "uncovered", "delivered", "all"] as const;
export type LoadBoardQueue = (typeof LOAD_BOARD_QUEUES)[number];

export const LOAD_BOARD_QUEUE_LABELS: Record<LoadBoardQueue, string> = {
  in_transit: "In transit",
  upcoming: "Upcoming",
  uncovered: "Uncovered",
  delivered: "Delivered",
  all: "All",
};

export type LoadBoardTone = "brand" | "info" | "warning" | "success" | "neutral";

export interface LoadBoardState {
  /** The queue the load belongs to. `all` is never returned: every load is in All as well. */
  queue: Exclude<LoadBoardQueue, "all"> | null;
  label: string;
  tone: LoadBoardTone;
  /** McLeod's code and its meaning, for the tooltip — null for a load McLeod never sent. */
  mcleodWords: string | null;
}

/** Alex's answers, 2026-09-24: the four movement statuses and what they mean at this carrier. */
const MCLEOD_STATUS_WORDS: Record<string, string> = {
  A: "available",
  P: "planned",
  D: "delivered",
  V: "void",
};

export interface BoardLoad {
  status: LoadStatus;
  source: string;
  external_status?: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
}

export function loadBoardState(load: BoardLoad): LoadBoardState {
  const code = (load.external_status ?? "").trim().toUpperCase();
  const mcleodWords =
    load.source === "tms" && code ? `McLeod status ${code}${MCLEOD_STATUS_WORDS[code] ? ` (${MCLEOD_STATUS_WORDS[code]})` : ""}` : null;
  const state = (queue: LoadBoardState["queue"], label: string, tone: LoadBoardTone): LoadBoardState => ({
    queue,
    label,
    tone,
    mcleodWords,
  });

  switch (load.status) {
    case "in_transit":
      return state("in_transit", "In transit", "brand");
    case "approved":
      return state("upcoming", "Planned", "info");
    case "pending_approval":
    case "draft":
      return load.driver_id && load.vehicle_id
        ? state("upcoming", "Planned", "info")
        : state("uncovered", "Uncovered", "warning");
    case "delivered":
      return state("delivered", "Delivered", "success");
    case "canceled":
      // Void in McLeod. In All only: it is neither work to do nor work done.
      return state(null, "Canceled", "neutral");
    default:
      // offered / accepted: only the driver app's own verbs reach these now, and the words for them
      // are the driver's ("Accepted"), which the status labels already carry. Taken but not yet under
      // way, so Upcoming — the same place McLeod's planned-but-not-departed `P` sits.
      return state("upcoming", LOAD_STATUS_LABELS[load.status], "brand");
  }
}

export interface BoardStop {
  seq: number;
  kind: "pickup" | "dropoff";
}

/**
 * The first pickup, the last delivery, and how many stops sit between or beside them. McLeod's
 * sequence decides the order (LR4b keeps it), so "first" and "last" are by `seq`, never by array order.
 */
export function boardStops<S extends BoardStop>(stops: readonly S[]): { pickup: S | null; delivery: S | null; extra: number } {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  const pickup = ordered.find((s) => s.kind === "pickup") ?? null;
  const delivery = [...ordered].reverse().find((s) => s.kind === "dropoff") ?? null;
  const shown = (pickup ? 1 : 0) + (delivery ? 1 : 0);
  return { pickup, delivery, extra: Math.max(0, ordered.length - shown) };
}

/**
 * The owner's "Type: Regular / Reefer / Hazmat" (2026-09-23). Reefer comes from McLeod's trailer type
 * (LR4b labels `R` "Reefer"); hazmat is Silvicom's own determination (D-LM12), never McLeod's, and a
 * hazmat reefer is both — so this returns the base type and the hazmat flag separately rather than
 * letting one hide the other.
 */
export function loadTypeOf(load: { equipment?: string | null; hazmat?: boolean | null }): {
  base: "Regular" | "Reefer";
  hazmat: boolean;
} {
  const reefer = (load.equipment ?? "").trim().toLowerCase() === "reefer";
  return { base: reefer ? "Reefer" : "Regular", hazmat: Boolean(load.hazmat) };
}

// ── ON A TRUCK NOW: the live map and the Assignments board ────────────────────────────────────────
//
// Both surfaces ask one question, "what is this truck / this driver hauling right now", and before
// 2026-09-28 each answered it with its own status list written for the approval chain LR6 removed
// (`accepted` / `in_transit`, plus `offered` on Assignments). A McLeod load never reaches `accepted` —
// the projection writes `approved` for `P` with nothing departed and `in_transit` once a stop is — so a
// load McLeod had planned onto a truck was drawn on neither. D-MCC12 (LOADS-GO-LIVE-PLAN.md) already
// ruled what the map draws: "ingest both, draw only `P`". `P` is exactly {approved, in_transit} on a
// `tms` load, and `A` (pending_approval, "Uncovered" or "Planned" on the board) is never drawn, even
// with a driver and truck on it, because McLeod has not dispatched it.
//
// A load that did not come from McLeod keeps the rule it always had: `approved` there means an office
// approved it and nobody has released it to a driver, which is not a truck hauling it.

/** On a McLeod load: movement `P` (D-MCC12). */
const TMS_ON_TRUCK: readonly LoadStatus[] = ["approved", "in_transit"];
/** On any other load: taken by the driver in the app, or under way. */
const OTHER_ON_TRUCK: readonly LoadStatus[] = ["accepted", "in_transit"];

/** Every status that can mean "on a truck" for SOME source — the widest a query may ask for. */
export const ON_TRUCK_CANDIDATE_STATUSES: readonly LoadStatus[] = [...new Set([...TMS_ON_TRUCK, ...OTHER_ON_TRUCK])];

export function isLoadOnTruck(load: { status: string; source: string | null }): boolean {
  const statuses = load.source === "tms" ? TMS_ON_TRUCK : OTHER_ON_TRUCK;
  return statuses.includes(load.status as LoadStatus);
}

/**
 * The load a DRIVER is working, for the Assignments board: on the truck, or — on a load that did not
 * come from McLeod — offered to them in the app and not yet answered, which is work in their hands
 * too. A McLeod load is never `offered`: the projection does not write it, and a Silvicom dispatch is
 * its own `load_dispatches` row, not a status (D-LMR6).
 */
export function isLoadWithDriver(load: { status: string; source: string | null }): boolean {
  return isLoadOnTruck(load) || (load.source !== "tms" && load.status === "offered");
}

/** Every status `isLoadWithDriver` can accept for some source — the widest the Assignments read asks for. */
export const WITH_DRIVER_CANDIDATE_STATUSES: readonly LoadStatus[] = [...ON_TRUCK_CANDIDATE_STATUSES, "offered"];

export interface RouteStop {
  seq: number | null;
  /** The driver app's status for the stop. */
  status: string | null;
  /** McLeod's own `stop.status`, verbatim (`A` / `D`); null on a load McLeod never sent. */
  external_status?: string | null;
}

/**
 * Behind the truck, by ANY source's evidence: the driver app finished it, or McLeod has the truck
 * departed. This is the office's reading of where a truck goes next. It does not rule whose account
 * wins (Q-LMR2): it only refuses to call a stop "next" when either source says the truck has left it.
 * Before this, a McLeod load's stops (driver status `pending` until a driver app ever touches them)
 * made the map name the pickup McLeod had departed as the next stop, on every McLeod truck.
 */
export function isStopBehindTruck(stop: RouteStop): boolean {
  return DRIVER_DONE_STOP_STATUSES.includes(stop.status as StopStatus) || mcleodStopDeparted(stop.external_status);
}

/** The first stop, by sequence, that is not behind the truck — null when every stop is. */
export function nextStopOnRoute<S extends RouteStop>(stops: readonly S[]): S | null {
  const ordered = [...stops].sort((a, b) => (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
  return ordered.find((s) => !isStopBehindTruck(s)) ?? null;
}

/**
 * When one truck or one driver holds more than one load at once, the one to show. The map draws one
 * marker per truck and Assignments one row per driver, so something must win, and it must not be row
 * order: the reads carry no ORDER BY and PostgREST promises none. None on the live board today (0 of
 * 96 `P` movements shared a tractor or a driver, 2026-09-28), but McLeod may plan a truck's next load
 * before it delivers this one, and the answer then is the one being driven: under way beats taken or
 * planned, which beats offered. A tie falls to the smaller load reference, then id, so it is the same
 * every time the board is read.
 */
const ON_TRUCK_PRECEDENCE: Partial<Record<LoadStatus, number>> = { in_transit: 3, accepted: 2, approved: 2, offered: 1 };

export function compareLoadsOnTruck(
  a: { id: string; ref: string | null; status: string },
  b: { id: string; ref: string | null; status: string },
): number {
  const rank = (s: string) => ON_TRUCK_PRECEDENCE[s as LoadStatus] ?? 0;
  return rank(b.status) - rank(a.status) || (a.ref ?? "").localeCompare(b.ref ?? "") || a.id.localeCompare(b.id);
}
