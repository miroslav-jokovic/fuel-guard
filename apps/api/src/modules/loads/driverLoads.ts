import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LOAD_ACTION_STATUSES,
  type AcceptLoadRequest,
  type AcknowledgeLoadRequest,
  type AddStopPhotosRequest,
  type CompleteStopRequest,
  type DeclineLoadRequest,
  type Load,
  type LoadActionStatus,
  type StartLoadRequest,
} from "@silvicom/shared";
import { getDriverLoad } from "./driverLoadReads.js";

/**
 * Driver-side load operations (Driver App Phase 3B, migration 0087, D45–D47).
 *
 * Same shape as `dutySessions.ts`, for the same reason: every mutation delegates to a
 * `security definer` Postgres function so the load row, its `load_events` entries and (for a stop)
 * its photos all land in ONE transaction. supabase-js cannot span a transaction, so doing it in
 * three calls would leave a load accepted with no event, or photos recorded against a stop that
 * never advanced — exactly the kind of half-write that makes an audit trail worthless.
 *
 * The reads — the load list the phone shows — are `driverLoadReads.ts`.
 *
 * The functions these calls rely on are 0141's, reshaped by 0661 (T1 N-8): one door,
 * `driver_load_access`, decides who may act on a load — the current dispatch's driver and the McLeod
 * co-driver now, anybody ever dispatched it as late evidence — and every action takes the outbox
 * record id (`p_action_id`, D-MK23) so a replay after a lost response does nothing twice.
 */

/**
 * SQLSTATE → response. These are the codes migration 0141 raises; `detail` below carries the specific
 * Postgres message, which names the failing gate or the exact missing photo slot.
 *
 * 0087 raised 'DL404' for "load not found", which this map has never had an entry for — so the most
 * ordinary driver error would have surfaced as an unhandled 500. 0141 raises DL002 there instead.
 */
const PG_TO_API: Record<string, { status: 404 | 409 | 422; code: string; message: string }> = {
  DL001: { status: 409, code: "not_offered", message: "This load is no longer waiting for you" },
  DL002: { status: 404, code: "not_your_load", message: "That load is not assigned to you" },
  DL003: { status: 409, code: "wrong_state", message: "This load has moved on — pull to refresh" },
  DL005: { status: 404, code: "stop_not_found", message: "That stop is not on this load" },
  DL006: { status: 422, code: "reason_required", message: "Add a note before finishing this" },
  // 0645: a late photo for a stop finished more than 14 days ago. The words are the driver's (D-DV26).
  DL007: { status: 422, code: "late_photo_window_closed", message: "This stop finished too long ago to add a photo. Send it to the office" },
  DL010: { status: 409, code: "illegal_transition", message: "That is not a step this load can take" },
  DL011: { status: 422, code: "not_ready", message: "This load is not ready for that yet" },
  // 0661 (T1 N-8). DL012: the phone sent one outbox record id for two different actions — a bug in
  // the phone, never the driver's doing, so it is a 422 the outbox parks rather than retries.
  DL012: { status: 422, code: "action_id_reused", message: "This action was already used for something else. Send it to the office" },
  // DL013 / DL014: a McLeod load has no Start, Accept or Decline step; its status is McLeod's (D-LMR2).
  DL013: { status: 409, code: "mcleod_load_has_no_start", message: "This load starts when you arrive at the first stop" },
  DL014: { status: 409, code: "mcleod_load_no_offer", message: "This load came from dispatch — there is nothing to accept" },
  DL015: { status: 422, code: "action_id_required", message: "Update the app, then try again" },
};

export type LoadResult =
  | { ok: true; load: Load | null; status: LoadActionStatus }
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

/**
 * What the function said it did. 0661's `driver_complete_stop` and `driver_acknowledge_load` answer
 * `{status}`; the late-photo function answers how many photos were new; accept, decline and start
 * answer nothing, and a call that did not raise recorded its action (a replay of those is the same
 * no-op answer, which the phone treats identically).
 */
function actionStatus(fn: string, data: unknown): LoadActionStatus {
  if (fn === "driver_add_stop_photos") return typeof data === "number" && data === 0 ? "replayed" : "photos_added";
  const status = (data as { status?: unknown } | null)?.status;
  return (LOAD_ACTION_STATUSES as readonly unknown[]).includes(status) ? (status as LoadActionStatus) : "recorded";
}

async function runRpc(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<LoadResult> {
  const { data, error } = await admin.rpc(fn, { p_org: orgId, p_driver: driverId, p_load: loadId, ...args });
  if (error) {
    const mapped = toLoadError(error);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  return { ok: true, status: actionStatus(fn, data), load: await getDriverLoad(admin, orgId, driverId, loadId) };
}

/**
 * Accept / acknowledge. Idempotent — a replayed offline accept returns the same load. Stamps the
 * driver's active duty session onto the load and, if the equipment they are actually in differs from
 * dispatch's plan, writes an `equipment_mismatch` event without blocking or overwriting (D47). A
 * McLeod load is refused (DL014): it has no offer, the driver says "Got it" instead.
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
    p_action_id: input.action_id ?? null,
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
    p_action_id: input.action_id ?? null,
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
    p_action_id: input.action_id ?? null,
  });
}

/**
 * "Got it" — the driver has seen the McLeod load the office sent (DF-2). The office reads it as "Seen
 * by driver" on the dispatch. The action id is required by the function itself (DL015).
 */
export function acknowledgeLoad(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  actorUserId: string,
  input: Partial<Pick<AcknowledgeLoadRequest, "action_id">> & Omit<AcknowledgeLoadRequest, "action_id">,
): Promise<LoadResult> {
  return runRpc(admin, orgId, driverId, loadId, "driver_acknowledge_load", {
    // Null reaches the function, which refuses it (DL015): the requirement lives there, not here.
    p_action_id: input.action_id ?? null,
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
  });
}

/** A photo as the functions store it: the client UUID, slot, path, capture time and, when sent, its hash. */
const photoArgs = (photos: CompleteStopRequest["photos"]) =>
  photos.map((p) => ({
    id: p.id,
    slot: p.slot,
    storage_path: p.storage_path,
    ...(p.captured_at !== undefined ? { captured_at: p.captured_at } : {}),
    ...(p.sha256 !== undefined ? { sha256: p.sha256 } : {}),
  }));

/**
 * Advance a stop and record the photos already uploaded to Storage. Photo `id`s are the client UUIDs
 * from the outbox and become the row PKs, so a replayed sync collides and no-ops. Completing a stop
 * without one of its required photos needs an explicit reason — never a block, never a dead end (D21).
 * A Complete carries the Arrive it followed (`arrived_at`, `arrive_action_id`, D-MK21), so a McLeod
 * stop's arrival is the driver's tap, never invented. `p_mcleod_write` is not sent: T-5 adds it.
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
    p_photos: photoArgs(input.photos),
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
    p_action_id: input.action_id ?? null,
    p_arrived_at: input.arrived_at ?? null,
    p_arrive_action_id: input.arrive_action_id ?? null,
  });
}

/**
 * A late photo for a stop the driver already finished (D-DV30, migration 0645). The function adds
 * photos and nothing else; the finished stop is not changed. Idempotent on the client photo UUIDs like
 * `completeStop`, so an outbox replay adds nothing and writes no second "Late photo received" event —
 * which is why the function takes no action id and none is passed.
 */
export function addStopPhotos(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  loadId: string,
  stopId: string,
  actorUserId: string,
  input: AddStopPhotosRequest,
): Promise<LoadResult> {
  return runRpc(admin, orgId, driverId, loadId, "driver_add_stop_photos", {
    p_stop: stopId,
    p_photos: photoArgs(input.photos),
    p_actor_user: actorUserId,
    p_occurred_at: input.occurred_at ?? null,
  });
}
