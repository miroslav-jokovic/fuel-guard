import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRIVER_VISIBLE_STATUSES,
  resolveDriverType,
  type AcceptLoadRequest,
  type CompleteStopRequest,
  type DeclineLoadRequest,
  type DriverType,
  type Load,
  type StartLoadRequest,
} from "@fuelguard/shared";

/**
 * Driver-side load operations (Driver App Phase 3B, migration 0087, D45–D47).
 *
 * Same shape as `dutySessions.ts`, for the same reason: every mutation delegates to a
 * `security definer` Postgres function so the load row, its `load_events` entries and (for a stop)
 * its photos all land in ONE transaction. supabase-js cannot span a transaction, so doing it in
 * three calls would leave a load accepted with no event, or photos recorded against a stop that
 * never advanced — exactly the kind of half-write that makes an audit trail worthless.
 *
 * Reads are RLS-scoped anyway, but go through the service role here so the response can join unit
 * numbers and nest stops in one round trip (D29 — no launch waterfall).
 */

const PG_TO_API: Record<string, { status: 404 | 409 | 422; code: string; message: string }> = {
  DL001: { status: 409, code: "not_offered", message: "This load is no longer waiting for you" },
  DL002: { status: 404, code: "not_your_load", message: "That load is not assigned to you" },
  DL003: { status: 409, code: "wrong_state", message: "This load has moved on — pull to refresh" },
  DL005: { status: 404, code: "stop_not_found", message: "That stop is not on this load" },
  DL006: { status: 422, code: "photo_reason_required", message: "Say why a required photo is missing" },
  DL010: { status: 409, code: "illegal_transition", message: "That is not a step this load can take" },
  DL011: { status: 422, code: "not_ready", message: "This load is not ready for that yet" },
};

export type LoadResult =
  | { ok: true; load: Load | null }
  | { ok: false; status: 404 | 409 | 422; code: string; message: string; detail?: string };

interface PgLikeError {
  code?: string | null;
  message?: string | null;
}

/** Translate a SQLSTATE raised by 0087 into the route's response, or null if it isn't ours. */
function toLoadError(error: PgLikeError): LoadResult | null {
  const mapped = PG_TO_API[error.code ?? ""];
  if (!mapped) return null;
  // The Postgres message names the specific missing photo / failed gate — surface it, since "not
  // ready" alone would leave a driver or dispatcher guessing.
  return { ok: false, ...mapped, ...(error.message ? { detail: error.message } : {}) };
}

const LOAD_COLUMNS =
  "id, ref, status, equipment, commodity, hazmat, total_miles, accepted_at, completed_at, notes, created_at, " +
  "vehicles(unit_number), trailers(unit_number)";

const STOP_COLUMNS =
  "id, seq, kind, name, address_line, city, state, postal_code, lat, lon, appointment_start, " +
  "appointment_end, status, arrived_at, completed_at, required_photos, skip_reason, notes, load_id";

type UnitJoin = { unit_number: string } | { unit_number: string }[] | null;
const unit = (u: UnitJoin): string | null =>
  Array.isArray(u) ? (u[0]?.unit_number ?? null) : (u?.unit_number ?? null);

/**
 * Every load the driver may see, stops and photos nested — one payload, no waterfall (D29).
 *
 * The status filter is the SAME predicate as `loads_driver_scope` in 0087. It is applied here too,
 * even though RLS would enforce it, because this call uses the service role: the API must not become
 * the one path that leaks an unapproved load.
 */
export async function getDriverLoads(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<Load[]> {
  const { data: loads } = await admin
    .from("loads")
    .select(LOAD_COLUMNS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .in("status", [...DRIVER_VISIBLE_STATUSES])
    .order("created_at", { ascending: false });

  const rows = (loads ?? []) as unknown as (Record<string, unknown> & {
    id: string;
    vehicles: UnitJoin;
    trailers: UnitJoin;
  })[];
  if (rows.length === 0) return [];

  const loadIds = rows.map((r) => r.id);
  const [stopsRes, photosRes] = await Promise.all([
    admin.from("load_stops").select(STOP_COLUMNS).in("load_id", loadIds).order("seq", { ascending: true }),
    admin
      .from("load_stop_photos")
      .select("id, slot, storage_path, captured_at, uploaded_at, stop_id")
      .in("load_id", loadIds)
      .order("uploaded_at", { ascending: true }),
  ]);

  type PhotoRow = { stop_id: string } & Record<string, unknown>;
  const photosByStop = new Map<string, Record<string, unknown>[]>();
  for (const p of (photosRes.data ?? []) as unknown as PhotoRow[]) {
    const { stop_id, ...rest } = p;
    const list = photosByStop.get(stop_id) ?? [];
    list.push(rest);
    photosByStop.set(stop_id, list);
  }

  type StopRow = { id: string; load_id: string } & Record<string, unknown>;
  const stopsByLoad = new Map<string, Record<string, unknown>[]>();
  for (const s of (stopsRes.data ?? []) as unknown as StopRow[]) {
    const { load_id, ...rest } = s;
    const list = stopsByLoad.get(load_id) ?? [];
    list.push({ ...rest, photos: photosByStop.get(s.id) ?? [] });
    stopsByLoad.set(load_id, list);
  }

  return rows.map((r) => {
    const { vehicles, trailers, ...rest } = r;
    return {
      ...rest,
      vehicle_unit: unit(vehicles),
      trailer_unit: unit(trailers),
      stops: stopsByLoad.get(r.id) ?? [],
    } as unknown as Load;
  });
}

/** One load, or null when the driver may not see it — used to return fresh state after a mutation. */
export async function getDriverLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
): Promise<Load | null> {
  const all = await getDriverLoads(admin, orgId, driverId);
  return all.find((l) => l.id === loadId) ?? null;
}

/** Company driver or owner-operator — decides the accept copy and the decline behaviour (D46). */
export async function getDriverType(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<DriverType> {
  const [driver, org] = await Promise.all([
    admin.from("drivers").select("driver_type").eq("id", driverId).maybeSingle(),
    admin.from("organizations").select("default_driver_type").eq("id", orgId).maybeSingle(),
  ]);
  return resolveDriverType(
    (driver.data as { driver_type?: string | null } | null)?.driver_type,
    (org.data as { default_driver_type?: string | null } | null)?.default_driver_type,
  );
}

async function runRpc(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<LoadResult> {
  const { error } = await admin.rpc(fn, { p_org: orgId, p_driver: driverId, p_load: loadId, ...args });
  if (error) {
    const mapped = toLoadError(error);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  return { ok: true, load: await getDriverLoad(admin, orgId, driverId, loadId) };
}

/**
 * Accept / acknowledge. Idempotent — a replayed offline accept returns the same load. Stamps the
 * driver's active duty session onto the load and, if the equipment they are actually in differs from
 * dispatch's plan, writes an `equipment_mismatch` event without blocking or overwriting (D47).
 */
export function acceptLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  actorUserId: string,
  input: AcceptLoadRequest,
): Promise<LoadResult> {
  return runRpc(admin, orgId, driverId, loadId, "driver_accept_load", {
    p_actor_user: actorUserId,
    p_occurred_at: input.accepted_at ?? null,
  });
}

/**
 * Decline. For an owner-operator this returns the load to the dispatch queue and clears the driver;
 * for a company driver it logs the exception and leaves dispatch to decide (D46). The difference
 * lives in the SQL function, so both populations use this one path.
 */
export function declineLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  actorUserId: string,
  input: DeclineLoadRequest,
): Promise<LoadResult> {
  const reason = input.note ? `${input.reason}: ${input.note}` : input.reason;
  return runRpc(admin, orgId, driverId, loadId, "driver_decline_load", {
    p_reason: reason,
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
  });
}

/** Explicit "rolling" — `accepted → in_transit`. Working the first stop does this implicitly too. */
export function startLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  actorUserId: string,
  input: StartLoadRequest,
): Promise<LoadResult> {
  return runRpc(admin, orgId, driverId, loadId, "driver_start_load", {
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
  });
}

/**
 * Advance a stop and record the photos already uploaded to Storage. Photo `id`s are the client UUIDs
 * from the outbox and become the row PKs, so a replayed sync collides and no-ops. Completing a stop
 * without one of its required photos needs an explicit reason — never a block, never a dead end (D21).
 */
export function completeStop(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  stopId: string,
  actorUserId: string,
  input: CompleteStopRequest,
): Promise<LoadResult> {
  return runRpc(admin, orgId, driverId, loadId, "driver_complete_stop", {
    p_stop: stopId,
    p_status: input.status,
    p_skip_reason: input.skip_reason ?? null,
    p_photos: input.photos,
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
  });
}
