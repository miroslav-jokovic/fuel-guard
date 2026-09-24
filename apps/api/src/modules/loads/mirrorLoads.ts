import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoadStatus, ProjectedLoad } from "@silvicom/shared";

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
 * The pending stops of each load are replaced; a stop a driver has worked (arrived, completed,
 * skipped) is never deleted — the rule `writeStops` has always kept. McLeod's arrival goes in
 * `actual_arrival_at`, beside the driver's `arrived_at`, never into it (Q-LMR2 is open).
 *
 * ── EVENTS ───────────────────────────────────────────────────────────────────────────────────────
 * `load_events` gets an append-only row when a load is first seen and each time McLeod moves its
 * status — the history nothing else keeps, since `loads` holds only the latest.
 */

export interface MirroredLoad extends Omit<ProjectedLoad, "driver_code" | "vehicle_unit" | "trailer_unit"> {
  driver_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
}

export interface MirrorWriteResult {
  created: number;
  updated: number;
  statusChanged: number;
  stops: number;
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
    vehicle_id: l.vehicle_id,
    trailer_id: l.trailer_id,
    dispatcher_external_id: l.dispatcher_external_id,
    customer_code: l.customer_code,
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

async function writeStops(admin: SupabaseClient, orgId: string, byLoad: Map<string, MirroredLoad>): Promise<number> {
  const loadIds = [...byLoad.keys()];
  for (let i = 0; i < loadIds.length; i += READ_CHUNK) {
    const { error } = await admin
      .from("load_stops")
      .delete()
      .eq("org_id", orgId)
      .in("load_id", loadIds.slice(i, i + READ_CHUNK))
      .eq("status", "pending");
    if (error) throw new Error(`[mcleod-mirror] could not clear pending stops: ${error.message}`);
  }
  const rows = [...byLoad].flatMap(([loadId, l]) =>
    l.stops.map((s) => ({
      org_id: orgId,
      load_id: loadId,
      ...s,
      // McLeod knows no carrier photo policy; dispatch sets the slots. The ingest's defaults, unchanged.
      required_photos: s.kind === "pickup" ? ["trailer", "bol"] : ["bol"],
    })),
  );
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("load_stops").upsert(rows.slice(i, i + 500), { onConflict: "load_id,seq" });
    if (error) throw new Error(`[mcleod-mirror] stops not recorded: ${error.message}`);
  }
  return rows.length;
}

export async function applyMirroredLoads(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  loads: MirroredLoad[],
): Promise<MirrorWriteResult> {
  if (!loads.length) return { created: 0, updated: 0, statusChanged: 0, stops: 0 };
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

  const stops = await writeStops(admin, orgId, byLoad);
  if (events.length) {
    // Best-effort, like the ingest's: a lost timeline row must not fail the sync that the load itself survived.
    const { error } = await admin.from("load_events").insert(events);
    if (error) console.error(`[mcleod-mirror] ${events.length} load event(s) not recorded: ${error.message}`);
  }
  return { created: creates.length, updated: updates.length, statusChanged, stops };
}
