import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsDispatchMovement } from "@silvicom/shared";

/**
 * The dispatch board, as McLeod states it → `mcleod_dispatch_movements` / `mcleod_dispatch_stops`
 * (LOADS-MIRROR-PLAN.md LR3, D-LMR3; tables 0364 + 0367).
 *
 * The collector half of D-LMR4: this file stores what McLeod said and decides nothing about it. No
 * status is projected, no stop type is named, no load is touched — that is LR4's projection, owned by
 * `loads`, which will read these rows and nothing else. So a mapping mistake there is fixed by
 * re-running the projection, never by re-pulling McLeod.
 *
 * ── COMPLETE ROWS (`lint:upserts`) ───────────────────────────────────────────────────────────────
 * Every column the feed owns is in every row; the contract makes each key required, so a missing field
 * fails at the door instead of being written as null over a value McLeod still has. Two columns are
 * deliberately absent, and their absence IS the rule: `first_seen_at` is left to its default on insert
 * and, not being in the row, is never rewritten on conflict — the first sighting survives every later
 * sync. `last_seen_at` is sent every time.
 *
 * ── `closed_at`: WHEN McLEOD SAID SO, AND ONLY THEN ──────────────────────────────────────────────
 * Stamped the first time a movement arrives as D (delivered) or V (void) — which only the close read
 * can see, since the board reads P and A — and KEPT on later syncs of the same state, which is why
 * the existing value is read first rather than recomputed as "now". A movement McLeod re-opens is open
 * again (null). Never set because a movement left the board: absence is not a statement (the
 * reconcile that retired 33 vehicles and 120 drivers inferred exactly that).
 *
 * ── A MOVEMENT'S STOPS ARE REPLACED, NOT MERGED ──────────────────────────────────────────────────
 * The payload carries a movement's WHOLE stop list, so a stop McLeod removed is one we still hold and
 * the payload does not name — deleted here, by id, scoped to the org and company. That is McLeod's
 * statement about the movement it sent, not an inference about one it did not: a movement absent from
 * this payload has its stops left exactly as they were.
 *
 * Service role, so every query filters `org_id` itself (and `company_id`, which is in every key).
 */

const MOVEMENT_CLOSED = new Set(["D", "V"]);
/** Movement ids per `.in()` read. ≤ 12 stops each measured, so 50 movements stay under PostgREST's 1,000. */
const READ_CHUNK = 50;
const WRITE_CHUNK = 500;

export interface DispatchMovementIngestResult {
  received: number;
  movements: number;
  stops: number;
  stopsRemoved: number;
  closed: number;
}

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function ingestDispatchMovements(
  admin: SupabaseClient,
  orgId: string,
  companyId: string,
  sent: TmsDispatchMovement[],
): Promise<DispatchMovementIngestResult> {
  // One row per movement: Postgres refuses an ON CONFLICT batch that names a key twice.
  const byId = new Map<string, TmsDispatchMovement>();
  for (const m of sent) byId.set(m.movement_id, m);
  const movements = [...byId.values()];
  if (!movements.length) return { received: 0, movements: 0, stops: 0, stopsRemoved: 0, closed: 0 };
  const ids = movements.map((m) => m.movement_id);
  const syncedAt = new Date().toISOString();

  const closedBefore = new Map<string, string | null>();
  for (const part of chunk(ids, READ_CHUNK)) {
    const { data, error } = await admin
      .from("mcleod_dispatch_movements")
      .select("movement_id, closed_at")
      .eq("org_id", orgId)
      .eq("company_id", companyId)
      .in("movement_id", part);
    if (error) throw new Error(`[dispatch-mirror] could not read existing movements: ${error.message}`);
    for (const r of (data ?? []) as { movement_id: string; closed_at: string | null }[]) closedBefore.set(r.movement_id, r.closed_at);
  }

  let closed = 0;
  const movementRows = movements.map((m) => {
    const isClosed = MOVEMENT_CLOSED.has(m.movement_status ?? "");
    if (isClosed) closed++;
    return {
      org_id: orgId,
      company_id: companyId,
      movement_id: m.movement_id,
      order_id: m.order_id,
      blnum: m.blnum,
      movement_status: m.movement_status,
      loaded: m.loaded,
      dispatcher_user_id: m.dispatcher_user_id,
      driver_codes: m.driver_codes,
      tractor_id: m.tractor_id,
      trailer_id: m.trailer_id,
      trailer_type: m.trailer_type,
      commodity: m.commodity,
      customer_id: m.customer_id,
      weight: m.weight,
      weight_um: m.weight_um,
      pieces: m.pieces,
      pallets_how_many: m.pallets_how_many,
      consignee_refno: m.consignee_refno,
      move_distance: m.move_distance,
      last_seen_at: syncedAt,
      closed_at: isClosed ? (closedBefore.get(m.movement_id) ?? syncedAt) : null,
    };
  });
  for (const part of chunk(movementRows, WRITE_CHUNK)) {
    const { error } = await admin
      .from("mcleod_dispatch_movements")
      .upsert(part, { onConflict: "org_id,company_id,movement_id" });
    if (error) throw new Error(`[dispatch-mirror] ${part.length} movement(s) not recorded: ${error.message}`);
  }

  const stopRows = new Map<string, Record<string, unknown>>();
  for (const m of movements) {
    for (const s of m.stops) {
      stopRows.set(s.stop_id, { org_id: orgId, company_id: companyId, movement_id: m.movement_id, ...s, last_seen_at: syncedAt });
    }
  }
  for (const part of chunk([...stopRows.values()], WRITE_CHUNK)) {
    const { error } = await admin
      .from("mcleod_dispatch_stops")
      .upsert(part, { onConflict: "org_id,company_id,stop_id" });
    if (error) throw new Error(`[dispatch-mirror] ${part.length} stop(s) not recorded: ${error.message}`);
  }

  const stale: string[] = [];
  for (const part of chunk(ids, READ_CHUNK)) {
    const { data, error } = await admin
      .from("mcleod_dispatch_stops")
      .select("stop_id")
      .eq("org_id", orgId)
      .eq("company_id", companyId)
      .in("movement_id", part);
    if (error) throw new Error(`[dispatch-mirror] could not read stops to reconcile: ${error.message}`);
    for (const r of (data ?? []) as { stop_id: string }[]) if (!stopRows.has(r.stop_id)) stale.push(r.stop_id);
  }
  for (const part of chunk(stale, WRITE_CHUNK)) {
    const { error } = await admin
      .from("mcleod_dispatch_stops")
      .delete()
      .eq("org_id", orgId)
      .eq("company_id", companyId)
      .in("stop_id", part);
    if (error) throw new Error(`[dispatch-mirror] ${part.length} removed stop(s) not deleted: ${error.message}`);
  }

  return { received: sent.length, movements: movementRows.length, stops: stopRows.size, stopsRemoved: stale.length, closed };
}
