import type { SupabaseClient } from "@supabase/supabase-js";
import { LOAD_COLUMNS, STOP_COLUMNS, one, type Join } from "./shared.js";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { dispatchesByLoad } from "../dispatchToDriver.js";
import { chunks, fetchAllPaged } from "../../../lib/paging.js";
import { readDispatcherNames } from "../../mcleod/index.js";

type DispatcherRef = { provider?: string | null; dispatcher_external_id?: string | null };

/**
 * The dispatcher McLeod names on each load, resolved to a name (LR7). One read for the whole board;
 * an id the roster does not hold yet comes back as the id itself, so the column is never silently
 * blank for a load that does have a dispatcher.
 */
export async function dispatcherNamesFor(
  admin: SupabaseClient,
  orgId: string,
  rows: DispatcherRef[],
): Promise<(row: DispatcherRef) => string | null> {
  const refs = rows
    .filter((r) => r.provider && r.dispatcher_external_id)
    .map((r) => ({ provider: r.provider!, externalId: r.dispatcher_external_id! }));
  const names = refs.length > 0 ? await readDispatcherNames(admin, orgId, refs) : new Map<string, string>();
  return (r) =>
    r.dispatcher_external_id
      ? (names.get(`${r.provider}:${r.dispatcher_external_id}`) ?? r.dispatcher_external_id)
      : null;
}

/**
 * Dispatch-side reads (P2 split). Wide by design — dispatch sees every status. The counterpart writes
 * live in `./mutations.ts`; the shared column lists + join helper in `./shared.ts`.
 */

/** Every load in the org with stops nested — dispatch's queue, all statuses. */
export async function listLoads(admin: SupabaseClient, orgId: string): Promise<unknown[]> {
  // Paged: the McLeod connector closes ~150 loads a day into `delivered`, and the board lists every
  // status, so the org's loads pass PostgREST's 1,000-row cap within days of the Board VM going live
  // (2026-10-09). `id` breaks created_at ties so no row falls between two pages.
  type Row = Record<string, unknown> & { id: string };
  const rows = await fetchAllPaged<Row>((from, to) =>
    admin
      .from("loads")
      .select(LOAD_COLUMNS)
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
      .then(({ data, error }) => ({ data: data as unknown as Row[] | null, error })),
  );
  if (rows.length === 0) return [];

  // In id chunks (IN_LIST_CHUNK): one `.in()` over the whole board overflowed Node 22's header limit
  // at 454 loads and failed every board read for an afternoon. A failed stops read now fails the board
  // — it used to be ignored, which would have shown every load without its pickup and delivery.
  const stops: { load_id: string }[] = [];
  for (const ids of chunks(rows.map((r) => r.id))) {
    const { data, error: stopsError } = await admin
      .from("load_stops")
      .select(STOP_COLUMNS)
      // Scoped to the org as well as to ids an org-scoped read produced: the service role bypasses RLS,
      // and a read that is only safe because of the query above it stops being safe when that changes.
      .eq("org_id", orgId)
      .in("load_id", ids)
      .order("seq", { ascending: true });
    if (stopsError) throw new Error(stopsError.message);
    stops.push(...((data ?? []) as unknown as { load_id: string }[]));
  }

  const byLoad = new Map<string, unknown[]>();
  for (const s of stops) {
    const list = byLoad.get(s.load_id) ?? [];
    list.push(s);
    byLoad.set(s.load_id, list);
  }

  // H-C1 (UI half): the board's hazmat chip shows the RECORD's state, not just the boolean — one
  // batched read over the linked records (partial unique index on load_id ⇒ at most one each).
  // Only hazmat-marked rows can be linked (link_hazmat_load sets loads.hazmat = true, one-way).
  const hazmatIds = rows.filter((r) => (r as { hazmat?: boolean }).hazmat).map((r) => r.id);
  const hazmatStatusBy = new Map<string, string>();
  if (hazmatIds.length > 0) {
    const { data: hz } = await admin
      .from("hazmat_loads")
      .select("load_id, status")
      .eq("org_id", orgId)
      .in("load_id", hazmatIds);
    for (const h of (hz ?? []) as { load_id: string | null; status: string }[]) {
      if (h.load_id) hazmatStatusBy.set(h.load_id, h.status);
    }
  }

  // D-LMR7: whether a McLeod load has been sent, and to whom, is the dispatch record — never status.
  const [dispatches, dispatcherOf] = await Promise.all([
    dispatchesByLoad(
      admin,
      orgId,
      rows.filter((r) => (r as { source?: string }).source === "tms").map((r) => r.id),
    ),
    dispatcherNamesFor(admin, orgId, rows as DispatcherRef[]),
  ]);

  return rows.map((r) => {
    const { drivers, vehicles, trailers, ...rest } = r as unknown as Record<string, unknown> & {
      drivers: Join;
      vehicles: Join;
      trailers: Join;
    };
    return {
      ...rest,
      driver_name: one(drivers)?.full_name ?? null,
      vehicle_unit: one(vehicles)?.unit_number ?? null,
      trailer_unit: one(trailers)?.unit_number ?? null,
      stops: byLoad.get(r.id) ?? [],
      // Null = hazmat-marked but no record started yet (or a non-hazmat load) — the chip says which.
      hazmat_status: hazmatStatusBy.get(r.id) ?? null,
      last_dispatch: dispatches.get(r.id)?.[0] ?? null,
      dispatcher_name: dispatcherOf(r as DispatcherRef),
    };
  });
}

/**
 * Resolve the humans behind a set of `actor_user_id`s.
 *
 * `load_events.actor_user_id` points at `auth.users`, which PostgREST does not expose, so there is no
 * embed that can do this. Since 0301 the org's directory answers every current member — a driver by
 * the roster's name, an office member by their profile's name or their email — in one call, and
 * `memberLabels` asks the auth admin API only for somebody who has since left the org. A deleted
 * login stays unresolved and must not blank out the whole timeline — the role is still shown.
 */
async function resolveActorNames(
  admin: SupabaseClient,
  orgId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;
  const labels = await memberLabels(admin, orgId, userIds);
  for (const [id, label] of labels) {
    const text = labelOf(label);
    if (text) names.set(id, text);
  }
  return names;
}

/**
 * The append-only timeline for one load, newest first, with the actor resolved.
 *
 * This used to select `..., drivers(full_name)` and discard the error. `load_events` has no foreign
 * key to `drivers` — its actor column references `auth.users` — so PostgREST could not resolve the
 * embed, the request failed, and the swallowed error meant `listEvents` returned `[]` for every load,
 * forever. The panel rendered "No history yet" and nobody could tell it apart from a load with no
 * history. Errors are thrown now for the same reason.
 */
export async function listEvents(admin: SupabaseClient, orgId: string, loadId: string): Promise<unknown[]> {
  const { data, error } = await admin
    .from("load_events")
    .select("id, kind, from_status, to_status, actor_user_id, actor_role, payload, occurred_at, recorded_at")
    .eq("org_id", orgId)
    .eq("load_id", loadId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Record<string, unknown> & { actor_user_id: string | null })[];
  const names = await resolveActorNames(
    admin,
    orgId,
    [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)))],
  );

  return rows.map((e) => ({
    ...e,
    actor_name: e.actor_user_id ? (names.get(e.actor_user_id) ?? null) : null,
  }));
}
