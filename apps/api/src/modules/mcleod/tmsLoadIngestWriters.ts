import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsLoadInput } from "@silvicom/shared";

/**
 * The write half of the TMS load ingest, set-based (L11).
 *
 * ⚠ WHY THIS FILE EXISTS, measured rather than assumed. The first production pull took **52.1
 * seconds for 157 loads** (board read finished 17:49:25.266, ingest acknowledged 17:50:17.330 on
 * 2026-09-17). `ingestLoads` was doing **six sequential round trips per load** — insert `loads`,
 * stamp `external_status`, upsert `load_external_payloads`, delete pending `load_stops`, upsert
 * `load_stops`, insert `load_events` — inside a plain `for` loop. That is **942 serial round trips
 * at ~55 ms each**, which is ordinary Railway→Supabase latency and nothing to do with the carrier's
 * server: their whole read costs **16 ms of CPU** (`docs/plans/mcleod/LOADS-GO-LIVE-PLAN.md` §4.1).
 *
 * At a 60-second cadence a 52-second ingest leaves eight seconds of headroom, which is not a cadence
 * but a queue waiting to form — so the schedule (L9) is held behind this.
 *
 * Every function here takes the WHOLE batch and issues ONE statement. The caller classifies first,
 * purely and in memory, so that no decision is made while holding a connection.
 */

/** A `load_events` row. Uniform keys on purpose: PostgREST rejects a bulk insert whose rows differ. */
export interface EventRow {
  org_id: string;
  load_id: string;
  actor_role: string;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  payload: Record<string, unknown>;
}

/**
 * Append the timeline entries for the whole batch in one insert.
 *
 * Best-effort, exactly as the per-load version was: a lost event is evidence about an ingest, and
 * losing it must never fail the ingest itself. `load_events` is append-only — batching the inserts
 * is fine, collapsing two events into one would not be.
 */
export async function writeEvents(admin: SupabaseClient, rows: EventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await admin.from("load_events").insert(rows);
  if (error) console.error(`[tms-loads] ${rows.length} load event(s) failed: ${error.message}`);
}

/**
 * Record the raw TMS payload for every load in the batch, in one upsert.
 *
 * Complete rows, never partial (`lint:upserts`): Postgres checks NOT NULL before conflict
 * arbitration, so a partial upsert fails on the insert branch it never reaches.
 *
 * Best-effort like the per-load version it replaces. A load that arrived is worth more than the
 * record of how it arrived. Drivers cannot read this table at all, because a McLeod order carries
 * rates.
 */
export async function writePayloads(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  syncedAt: string,
  entries: { loadId: string; raw: unknown }[],
): Promise<void> {
  const rows = entries
    .filter((e) => e.raw !== undefined && e.raw !== null)
    .map((e) => ({ load_id: e.loadId, org_id: orgId, provider, raw: e.raw, synced_at: syncedAt }));
  if (rows.length === 0) return;
  const { error } = await admin.from("load_external_payloads").upsert(rows, { onConflict: "load_id" });
  if (error) console.error(`[tms-loads] ${rows.length} payload(s) not recorded: ${error.message}`);
}

/**
 * Stamp what the TMS currently says ABOUT each load: its status word and, when the feed sent one, its
 * dispatcher.
 *
 * Both are attribution, not dispatch decisions, so both are stamped even on a load dispatch owns and
 * the feed may not otherwise write. `external_status` is the evidence behind the amendment banner and
 * the field the cancellation path reads. `dispatcher_external_id` joined it in L4 because an approved
 * load is exactly the one on a dispatcher's board (LM8's rail filters on it), and McLeod reassigns
 * loads between dispatchers after they are covered — frozen at approval, a load would stay on the
 * wrong person's board for the rest of its life. Nothing in Silvicom sets it, so there is no human
 * decision here for the feed to overwrite.
 *
 * A key the feed said nothing about is left out of the stamp rather than written as null: `undefined`
 * is silence, not a clear (see classify in tmsLoadIngest.ts).
 *
 * Grouped by VALUE rather than issued per load, because one UPDATE can only set one value. The live
 * board carries two statuses and ~15 dispatchers, so this is at most a few dozen statements for any
 * batch size rather than one per load.
 */
export async function stampExternalStatus(
  admin: SupabaseClient,
  orgId: string,
  syncedAt: string,
  entries: { loadId: string; externalStatus: string | null; dispatcherExternalId?: string | null }[],
): Promise<void> {
  const byValue = new Map<string, string[]>();
  for (const e of entries) {
    const stamp: Record<string, unknown> = { external_status: e.externalStatus ?? null };
    if (e.dispatcherExternalId !== undefined) stamp.dispatcher_external_id = e.dispatcherExternalId;
    const key = JSON.stringify(stamp);
    const bucket = byValue.get(key);
    if (bucket) bucket.push(e.loadId);
    else byValue.set(key, [e.loadId]);
  }
  for (const [key, ids] of byValue) {
    const { error } = await admin
      .from("loads")
      .update({ ...(JSON.parse(key) as Record<string, unknown>), external_synced_at: syncedAt })
      // Service role bypasses RLS, so this carries its own org filter like every other query here.
      .in("id", ids)
      .eq("org_id", orgId);
    if (error) console.error(`[tms-loads] provenance not recorded for ${ids.length} load(s): ${error.message}`);
  }
}

/**
 * Replace the stops of every load the feed still owns, in two statements for the whole batch.
 *
 * ⚠ `status = 'pending'` is the whole safety property and it is preserved exactly: a stop a driver
 * has already worked (arrived, completed, skipped) is never deleted, so a re-sync cannot erase
 * evidence of work. Widening that filter would be a data-loss bug, not a performance change.
 */
export async function writeStops(
  admin: SupabaseClient,
  orgId: string,
  entries: { loadId: string; stops: TmsLoadInput["stops"] }[],
): Promise<void> {
  if (entries.length === 0) return;
  const loadIds = entries.map((e) => e.loadId);
  await admin
    .from("load_stops")
    .delete()
    .in("load_id", loadIds)
    .eq("org_id", orgId)
    .eq("status", "pending");

  const rows = entries.flatMap((e) =>
    e.stops.map((s) => ({
      org_id: orgId,
      load_id: e.loadId,
      seq: s.seq,
      kind: s.kind,
      name: s.name,
      address_line: s.address_line ?? null,
      city: s.city ?? null,
      state: s.state ?? null,
      postal_code: s.postal_code ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
      appointment_start: s.appointment_start ?? null,
      appointment_end: s.appointment_end ?? null,
      // The feed does not know a carrier's photo policy — dispatch sets those slots. Defaults keep a
      // driver from arriving at a shipper with nothing to capture.
      required_photos: s.kind === "pickup" ? ["trailer", "bol"] : ["bol"],
      notes: s.notes ?? null,
    })),
  );
  if (rows.length === 0) return;
  const { error } = await admin.from("load_stops").upsert(rows, { onConflict: "load_id,seq" });
  if (error) throw new Error(error.message);
}

/**
 * Insert the new loads and hand back their ids, keyed by `external_id`.
 *
 * Takes GROUPS rather than one list because PostgREST rejects a bulk insert whose rows do not share
 * a key set, and `hazmat` is deliberately absent from some rows and present in others (D-LM12 — an
 * absent value must fall to the column default, never be collapsed to null). Two statements for any
 * batch size, rather than one per load.
 *
 * ⚠ The returned rows are paired back by `external_id`, never by position: PostgREST does not promise
 * they come back in the order they were sent, and a mis-paired id would attach one load's stops to
 * another load. Pinned by "attaches every stop to the load that sent it, whatever order the insert
 * returned" — a test whose stub returns the rows reversed, because on an ordered fixture a positional
 * bug passes the entire suite.
 */
export async function insertCreates(
  admin: SupabaseClient,
  groups: Record<string, unknown>[][],
): Promise<Map<string, string>> {
  const idByExternal = new Map<string, string>();
  for (const rows of groups) {
    if (rows.length === 0) continue;
    const { data, error } = await admin.from("loads").insert(rows).select("id, external_id");
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { id: string; external_id: string }[]) {
      idByExternal.set(r.external_id, r.id);
    }
  }
  return idByExternal;
}

/** Cancel every load the TMS withdrew, in one statement per prior status (for the event's `from`). */
export async function applyCancels(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await admin
    .from("loads")
    .update({ status: "canceled", cancel_reason: "Canceled in the TMS" })
    .in("id", ids)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

/**
 * Apply the per-load patches for loads the feed still owns.
 *
 * ⚠ **LABELLED DELIBERATE INTERMEDIATE, not the finished shape.** This is the one path still issuing
 * a statement per row, because each patch sets DIFFERENT values and one UPDATE can only set one.
 * The repository's own answer to that is a set-based UPDATE RPC taking a jsonb array (migrations
 * 0174/0175 are the pattern); that needs a migration, and a migration needs its own merge ahead of
 * its first reader, so it is recorded as **L11b** in `LOADS-GO-LIVE-PLAN.md` rather than smuggled in
 * here. What removes this function is that RPC.
 *
 * Until then the patches run with bounded concurrency instead of strictly serially. The bound is
 * deliberate: unbounded `Promise.all` over a whole board would open as many sockets as there are
 * loads, which trades one bottleneck for a worse one.
 *
 * This path is also the one that shrinks by itself: once the change detector lands (L7) a cycle
 * carries the ~28 movements that changed in the last hour, not all 157.
 */
export async function applyOverwrites(
  admin: SupabaseClient,
  orgId: string,
  patches: { loadId: string; patch: Record<string, unknown> }[],
  concurrency = 8,
): Promise<void> {
  for (let i = 0; i < patches.length; i += concurrency) {
    const slice = patches.slice(i, i + concurrency);
    const errors = await Promise.all(
      slice.map(async ({ loadId, patch }) => {
        const { error } = await admin.from("loads").update(patch).eq("id", loadId).eq("org_id", orgId);
        return error?.message ?? null;
      }),
    );
    const failed = errors.find((e) => e !== null);
    if (failed) throw new Error(failed);
  }
}
