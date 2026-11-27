import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredPhotosFor, type LoadStatus, type ProjectedLoad } from "@silvicom/shared";

/**
 * The write half of the McLeod projection (LOADS-MIRROR-PLAN.md LR4; D-LMR2, D-LMR4, D-LMR7) — the
 * `loads` module's interface for "McLeod says this load now looks like this".
 *
 * The collector (`mcleod/dispatchProjection.ts`) reads its raw tables, runs the pure projection in
 * `@silvicom/shared`, resolves unit and driver codes, and calls this. So the ownership line is the one
 * D-ARC3 draws: only `loads` writes `loads`, only `mcleod` reads `mcleod_dispatch_*`.
 *
 * ── ALWAYS OVERWRITE, BUT ONLY WHAT McLEOD OWNS ──────────────────────────────────────────────────
 * D-LMR2: no `tmsMayOverwrite`, no `amended` events — McLeod is the author. But the patch names only
 * the columns the projection produces. What Silvicom decided stays untouched on every sync: `hazmat`
 * (our rules engine, D-LM12), `notes`, the approval and release stamps, and — after LR-D — the
 * dispatch record, which is not on this table at all (D-LMR6).
 *
 * ── STOPS ────────────────────────────────────────────────────────────────────────────────────────
 * Since S0b (T1 N-7) a stop is matched by McLeod's stop id and updated in place by
 * `apply_mcleod_load_stops`, so its `load_stops.id` lives as long as the McLeod stop does; one McLeod
 * stopped listing is stamped `mcleod_removed_at`, never deleted. McLeod's arrival goes in
 * `actual_arrival_at`, beside the driver's `arrived_at`, never into it (Q-LMR2 is open).
 *
 * ── EVENTS ───────────────────────────────────────────────────────────────────────────────────────
 * `load_events` gets an append-only row when a load is first seen and each time McLeod moves its
 * status — the history nothing else keeps, since `loads` holds only the latest.
 */

export interface MirroredLoad extends Omit<ProjectedLoad, "driver_code" | "co_driver_code" | "vehicle_unit" | "trailer_unit"> {
  driver_id: string | null;
  /** A team's second seat (0493, LOADS-ACTIVITY-PLAN D-LA2); null on a solo run. */
  co_driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
}

export interface MirrorWriteResult {
  created: number;
  updated: number;
  statusChanged: number;
  stops: number;
  /** Loads written with a price to `load_charges` (0639) this sync. */
  charges: number;
  /** Loads whose stops `apply_mcleod_load_stops` refused, with its reason (0660; T1 N-7). Not thrown. */
  stopsRefused: { loadId: string; reason: string }[];
}

const READ_CHUNK = 200;
const CONCURRENCY = 8;

/** The event kind that says what McLeod did, from the vocabulary `load_events` already checks. */
function eventKind(to: LoadStatus): string {
  if (to === "canceled") return "canceled";
  if (to === "delivered") return "completed";
  if (to === "in_transit") return "started";
  return "load_changed";
}

function loadColumns(l: MirroredLoad, syncedAt: string): Record<string, unknown> {
  return {
    ref: l.ref,
    status: l.status,
    external_status: l.external_status,
    equipment: l.equipment,
    commodity: l.commodity,
    total_miles: l.total_miles,
    driver_id: l.driver_id,
    co_driver_id: l.co_driver_id,
    vehicle_id: l.vehicle_id,
    trailer_id: l.trailer_id,
    dispatcher_external_id: l.dispatcher_external_id,
    customer_code: l.customer_code,
    customer_name: l.customer_name,
    weight_lbs: l.weight_lbs,
    pieces: l.pieces,
    consignee_ref: l.consignee_ref,
    loaded: l.loaded,
    external_closed_at: l.external_closed_at,
    cancel_reason: l.status === "canceled" ? "Voided in McLeod" : null,
    external_synced_at: syncedAt,
  };
}

async function readExisting(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  externalIds: string[],
): Promise<Map<string, { id: string; status: LoadStatus }>> {
  const out = new Map<string, { id: string; status: LoadStatus }>();
  for (let i = 0; i < externalIds.length; i += READ_CHUNK) {
    const { data, error } = await admin
      .from("loads")
      .select("id, status, external_id")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .eq("source", "tms")
      .in("external_id", externalIds.slice(i, i + READ_CHUNK));
    if (error) throw new Error(`[mcleod-mirror] could not read existing loads: ${error.message}`);
    for (const r of (data ?? []) as { id: string; status: LoadStatus; external_id: string }[]) {
      out.set(r.external_id, { id: r.id, status: r.status });
    }
  }
  return out;
}

/** Loads per `apply_mcleod_load_stops` call. A load's stops always travel together (they are one item). */
const STOP_RPC_CHUNK = 50;

interface StopApplyResult {
  written: string[];
  refused: { load_id: string; reason: string }[];
}

/**
 * Every McLeod stop goes through `apply_mcleod_load_stops` (0660; T1 N-7 S0b, D-MK15, D-MK16), keyed on
 * McLeod's stop id. Until S0b this deleted each load's pending stops and re-inserted them on
 * `(load_id, seq)` every 60-second sweep, so `load_stops.id` churned and a phone that queued "arrived at
 * stop <id>" offline came back to an id that no longer existed (Spec A C1/C2); and because it keyed on
 * `seq`, a worked stop McLeod re-sequenced took its neighbour's address. The function updates in place,
 * never touches the driver's columns (status, arrived_at, completed_at, skip_reason), and stamps
 * `mcleod_removed_at` on a stop McLeod stopped listing instead of deleting it, since the stop's photos
 * cascade from it.
 *
 * One load that the function refuses (another org's id, a tail over 200, a band left non-empty, a stop
 * with no McLeod id) is RETURNED, not raised — the rest of the batch is written and the sweep goes on. A
 * thrown RPC error still throws: that is the batch's failure (or a 40001/40P01 the function re-raises),
 * and the connector re-sends the batch next cycle.
 */
async function writeStops(
  admin: SupabaseClient,
  orgId: string,
  byLoad: Map<string, MirroredLoad>,
): Promise<{ stops: number; refused: { loadId: string; reason: string }[] }> {
  const items = [...byLoad].map(([loadId, l]) => ({
    load_id: loadId,
    stops: l.stops.map((s) => ({
      ...s,
      // McLeod knows no carrier photo policy, and nothing in the office sets it on a McLeod load since LR6
      // removed editing, so every sync writes the carrier's one rule (`REQUIRED_PHOTOS_BY_STOP_KIND` in
      // `@silvicom/shared`) on the stops it writes.
      required_photos: requiredPhotosFor(s.kind),
    })),
  }));
  const refused: { loadId: string; reason: string }[] = [];
  const written = new Set<string>();
  for (let i = 0; i < items.length; i += STOP_RPC_CHUNK) {
    const { data, error } = await admin.rpc("apply_mcleod_load_stops", { p_org: orgId, p_loads: items.slice(i, i + STOP_RPC_CHUNK) });
    if (error) throw new Error(`[mcleod-mirror] stops not recorded: ${error.message}`);
    const out = (data ?? { written: [], refused: [] }) as StopApplyResult;
    for (const id of out.written ?? []) written.add(id);
    for (const r of out.refused ?? []) refused.push({ loadId: r.load_id, reason: r.reason });
  }
  // Counts only: a refusal's message can carry stop data, and the load_events row already names the load.
  if (refused.length) console.warn(`[mcleod-mirror] stops refused: ${refused.length}`);
  const stops = items.reduce((n, it) => n + (written.has(it.load_id) ? it.stops.length : 0), 0);
  return { stops, refused };
}

/**
 * What each projected load pays → `load_charges` (0639, LOAD-RATES-PLAN D-RATE2, D-RATE3).
 *
 * A load the projection priced gets its row written whole (every column, `lint:upserts`), keyed on the
 * load. A load it did NOT price loses any row it had: McLeod voided it, turned it empty, or stopped stating
 * a total, and a figure McLeod no longer states must not stay on the screen. Before the Board VM runs the
 * connector that reads charges, every load is unpriced and every delete finds nothing.
 *
 * ⚠ The rows never reach a browser: the table has RLS on and no policy. Who is SENT a figure is decided
 * where it is read (D-RATE7), never here.
 */
async function writeCharges(
  admin: SupabaseClient,
  orgId: string,
  byLoad: Map<string, MirroredLoad>,
  syncedAt: string,
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  const unpriced: string[] = [];
  for (const [loadId, l] of byLoad) {
    if (l.charge) rows.push({ load_id: loadId, org_id: orgId, ...l.charge, updated_at: syncedAt });
    else unpriced.push(loadId);
  }
  for (let i = 0; i < unpriced.length; i += READ_CHUNK) {
    const { error } = await admin.from("load_charges").delete().eq("org_id", orgId).in("load_id", unpriced.slice(i, i + READ_CHUNK));
    if (error) throw new Error(`[mcleod-mirror] could not clear prices no longer stated: ${error.message}`);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("load_charges").upsert(rows.slice(i, i + 500), { onConflict: "load_id" });
    if (error) throw new Error(`[mcleod-mirror] prices not recorded: ${error.message}`);
  }
  return rows.length;
}

/** The four roster links a mirrored load holds, as the relink pass compares them (D-LA3). */
export interface MirroredLinks {
  external_id: string;
  driver_id: string | null;
  co_driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
}

/**
 * What each mirrored load is linked to now, for the relink pass (LOADS-ACTIVITY-PLAN D-LA3). The
 * `mcleod` collector asks this module rather than reading `loads` itself (D-ARC3). In chunks, as
 * `readExisting` does, because the ids come from every recent movement.
 */
export async function readMirroredLinks(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  externalIds: string[],
): Promise<Map<string, MirroredLinks>> {
  const out = new Map<string, MirroredLinks>();
  for (let i = 0; i < externalIds.length; i += READ_CHUNK) {
    const { data, error } = await admin
      .from("loads")
      .select("external_id, driver_id, co_driver_id, vehicle_id, trailer_id")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .eq("source", "tms")
      .in("external_id", externalIds.slice(i, i + READ_CHUNK));
    if (error) throw new Error(`[mcleod-mirror] could not read load links: ${error.message}`);
    for (const r of (data ?? []) as MirroredLinks[]) out.set(r.external_id, r);
  }
  return out;
}

export async function applyMirroredLoads(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  loads: MirroredLoad[],
): Promise<MirrorWriteResult> {
  if (!loads.length) return { created: 0, updated: 0, statusChanged: 0, stops: 0, charges: 0, stopsRefused: [] };
  const syncedAt = new Date().toISOString();
  const existing = await readExisting(admin, orgId, provider, loads.map((l) => l.external_id));
  const events: Record<string, unknown>[] = [];
  const byLoad = new Map<string, MirroredLoad>();

  const creates = loads.filter((l) => !existing.has(l.external_id));
  if (creates.length) {
    const { data, error } = await admin
      .from("loads")
      .insert(creates.map((l) => ({ org_id: orgId, source: "tms", provider, external_id: l.external_id, ...loadColumns(l, syncedAt) })))
      .select("id, external_id");
    if (error) throw new Error(`[mcleod-mirror] ${creates.length} load(s) not created: ${error.message}`);
    // Paired by external_id, never by position: PostgREST does not promise the order it returns rows in.
    const ids = new Map(((data ?? []) as { id: string; external_id: string }[]).map((r) => [r.external_id, r.id]));
    for (const l of creates) {
      const id = ids.get(l.external_id);
      if (!id) throw new Error(`[mcleod-mirror] insert returned no id for ${l.external_id}`);
      byLoad.set(id, l);
      events.push({ org_id: orgId, load_id: id, actor_role: "system", kind: "created", from_status: null, to_status: l.status,
        payload: { source: "mcleod", external_id: l.external_id, mcleod_status: l.external_status } });
    }
  }

  const updates = loads.filter((l) => existing.has(l.external_id));
  let statusChanged = 0;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const failed = (
      await Promise.all(
        updates.slice(i, i + CONCURRENCY).map(async (l) => {
          const prior = existing.get(l.external_id)!;
          const { error } = await admin.from("loads").update(loadColumns(l, syncedAt)).eq("id", prior.id).eq("org_id", orgId);
          return error?.message ?? null;
        }),
      )
    ).find((e) => e !== null);
    if (failed) throw new Error(`[mcleod-mirror] load update failed: ${failed}`);
  }
  for (const l of updates) {
    const prior = existing.get(l.external_id)!;
    byLoad.set(prior.id, l);
    if (prior.status === l.status) continue;
    statusChanged++;
    events.push({ org_id: orgId, load_id: prior.id, actor_role: "system", kind: eventKind(l.status), from_status: prior.status,
      to_status: l.status, payload: { source: "mcleod", mcleod_status: l.external_status } });
  }

  const { stops, refused: stopsRefused } = await writeStops(admin, orgId, byLoad);
  const charges = await writeCharges(admin, orgId, byLoad, syncedAt);
  if (events.length) {
    // Best-effort, like the ingest's: a lost timeline row must not fail the sync that the load itself survived.
    const { error } = await admin.from("load_events").insert(events);
    if (error) console.error(`[mcleod-mirror] ${events.length} load event(s) not recorded: ${error.message}`);
  }
  return { created: creates.length, updated: updates.length, statusChanged, stops, charges, stopsRefused };
}
