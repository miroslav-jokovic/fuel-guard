import type { LoadStatus } from "./loadsContract.js";
import { LOAD_STATUS_LABELS } from "./loadsLifecycle.js";

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

export const LOAD_BOARD_QUEUES = ["active", "uncovered", "delivered", "all"] as const;
export type LoadBoardQueue = (typeof LOAD_BOARD_QUEUES)[number];

export const LOAD_BOARD_QUEUE_LABELS: Record<LoadBoardQueue, string> = {
  active: "Active",
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
      return state("active", "In transit", "brand");
    case "approved":
      return state("active", "Planned", "info");
    case "pending_approval":
    case "draft":
      return load.driver_id && load.vehicle_id
        ? state("active", "Planned", "info")
        : state("uncovered", "Uncovered", "warning");
    case "delivered":
      return state("delivered", "Delivered", "success");
    case "canceled":
      // Void in McLeod. In All only: it is neither work to do nor work done.
      return state(null, "Canceled", "neutral");
    default:
      // offered / accepted: only the driver app's own verbs reach these now, and the words for them
      // are the driver's ("Accepted"), which the status labels already carry.
      return state("active", LOAD_STATUS_LABELS[load.status], "brand");
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
