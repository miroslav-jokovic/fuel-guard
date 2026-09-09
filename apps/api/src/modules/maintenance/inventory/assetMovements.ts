import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetMovementDto, AssetMovementInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * The asset ledger, and the one function that writes it (INVENTORY-PLAN.md step I7, D-INV3/24/27).
 *
 * ── WHY THIS CALLS AN RPC AND NOT TWO STATEMENTS ───────────────────────────────────────────────
 * A move is a ledger row AND a holder change. Doing that from here would be two round trips with no
 * transaction around them, so a network blip between them leaves a tablet whose history says it
 * went into 654 and whose row still says 611 — the one failure this design exists to prevent.
 * `move_asset` is `security definer` and does both inside one statement's transaction.
 *
 * ── THE SQLSTATES ARE MAPPED, NOT SWALLOWED ────────────────────────────────────────────────────
 * 0333 raises named `IV0xx` codes for the things a technician can actually do: put a second tablet
 * in a truck that carries one, move something that has been retired, name an asset that is not
 * ours. Letting those fall through as a generic 500 would put "Something went wrong" in front of
 * somebody standing at a truck holding the thing.
 */

const COLUMNS =
  "id, asset_id, reason, from_location_id, from_vehicle_id, from_trailer_id, to_location_id, " +
  "to_vehicle_id, to_trailer_id, condition, note, actor_user_id, actor_driver_id, count_session_id, " +
  "occurred_at, received_at";

interface MovementRow {
  id: string;
  asset_id: string;
  reason: AssetMovementDto["reason"];
  from_location_id: string | null;
  from_vehicle_id: string | null;
  from_trailer_id: string | null;
  to_location_id: string | null;
  to_vehicle_id: string | null;
  to_trailer_id: string | null;
  condition: AssetMovementDto["condition"];
  note: string | null;
  actor_user_id: string | null;
  actor_driver_id: string | null;
  count_session_id: string | null;
  occurred_at: string;
  received_at: string;
}

/**
 * A movement's two ends, as the timeline reads them.
 *
 * Labels are null here and the ids are not. A history is rendered against a page of units the
 * screen already has (I8 promotes `CaseTimeline.vue` for it); resolving three joins per row on both
 * ends would be six joins a row for a name the caller can already spell. `assetHolderSchema` is
 * shared with `AssetDto.holder`, where the label IS resolved, because there it is the answer rather
 * than a reference.
 */
const endpoint = (
  locationId: string | null,
  vehicleId: string | null,
  trailerId: string | null,
): AssetMovementDto["fromHolder"] => {
  if (!locationId && !vehicleId && !trailerId) return null;
  return {
    kind: locationId ? "location" : vehicleId ? "vehicle" : "trailer",
    id: locationId ?? vehicleId ?? trailerId,
    label: null,
    inferredDriverName: null,
    since: null,
  };
};

export const toAssetMovementDto = (
  r: MovementRow,
  actorName: string | null = null,
): AssetMovementDto => ({
  id: r.id,
  assetId: r.asset_id,
  reason: r.reason,
  fromHolder: endpoint(r.from_location_id, r.from_vehicle_id, r.from_trailer_id),
  toHolder: endpoint(r.to_location_id, r.to_vehicle_id, r.to_trailer_id),
  condition: r.condition,
  note: r.note,
  actorUserId: r.actor_user_id,
  actorName,
  actorDriverId: r.actor_driver_id,
  countSessionId: r.count_session_id,
  occurredAt: r.occurred_at,
  receivedAt: r.received_at,
});

/**
 * What the shop is told when the database refuses.
 *
 * `IV016` is deliberately phrased as a wait rather than a failure: it means an identical movement is
 * mid-insert on another connection, which happens when a queued write and a foreground retry race.
 * The movement is about to exist, so "try again" is the true sentence and "it failed" is not —
 * `movements.ts` says the same thing about the same code for the same reason.
 */
const MESSAGES: Record<string, string> = {
  IV012: "That bay, truck or trailer is not available.",
  IV014: "This device's clock looks wrong — check the date and try again.",
  IV015: "That movement is incomplete.",
  IV016: "That move is already being recorded — try again in a moment.",
  IV020: "That unit already holds the one of these it is expected to carry.",
  IV021: "The movement history cannot be edited — record a correction instead.",
  IV023: "That asset has been retired.",
  IV024: "That asset is not available.",
};

export interface ListAssetMovementsOptions {
  assetId?: string;
  countSessionId?: string;
  vehicleId?: string;
  trailerId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export async function listAssetMovements(
  admin: SupabaseClient,
  orgId: string,
  opts: ListAssetMovementsOptions = {},
): Promise<{ movements: AssetMovementDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("asset_movements").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (opts.assetId) q = q.eq("asset_id", opts.assetId);
  if (opts.countSessionId) q = q.eq("count_session_id", opts.countSessionId);
  // A unit's history is what LANDED there, which is the `to_` end. The `from_` end of the same row
  // belongs to the unit it left, and asking for both would report every departure twice.
  if (opts.vehicleId) q = q.eq("to_vehicle_id", opts.vehicleId);
  if (opts.trailerId) q = q.eq("to_trailer_id", opts.trailerId);
  if (opts.since) q = q.gte("occurred_at", opts.since);
  if (opts.until) q = q.lte("occurred_at", opts.until);

  const { data, error, count } = await q
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return traced("listAssetMovements", "db_error", "Could not load the asset history", error);

  const rows = (data ?? []) as unknown as MovementRow[];
  // One directory call for the page, never one per row — the shape `lib/memberLabels` exists to
  // enforce, and the omission the 2026-09-09 review had to repair on `listMovements`.
  const labels = await memberLabels(
    admin,
    orgId,
    rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id)),
  );
  return {
    movements: rows.map((r) =>
      toAssetMovementDto(r, r.actor_user_id ? labelOf(labels.get(r.actor_user_id)) : null),
    ),
    total: count ?? 0,
  };
}

/**
 * The only writer of an asset's holder.
 *
 * `input` is a validated `AssetMovementInput` and reaches the RPC very nearly verbatim: which
 * reasons move the holder, where the movement came from, and whether the target may hold it are all
 * decided in SQL, so there is no rule in this function to get out of step with the one in 0333.
 *
 * The `id` comes from the CLIENT (D-INV27) and is the idempotency key, exactly as a part movement's
 * does — the unit check that writes these runs on the same phone in the same dead bay as the shelf
 * count that writes those. A caller that generates one per attempt rather than per movement has
 * broken the offline queue's server half without breaking any test.
 */
export async function moveAsset(
  admin: SupabaseClient,
  orgId: string,
  actorUserId: string | null,
  input: AssetMovementInput,
): Promise<AssetMovementDto | ServiceError> {
  const { data, error } = await admin.rpc("move_asset", {
    p_org: orgId,
    p_actor: actorUserId,
    p_row: input,
  });

  if (error) {
    const known = error.code && MESSAGES[error.code];
    if (known) return { error: known, code: error.code as string };
    return traced("moveAsset", "db_error", "Could not record the move", error);
  }
  // `returns asset_movements` gives PostgREST a composite, which it renders as a single object.
  const row = (Array.isArray(data) ? data[0] : data) as unknown as MovementRow | null;
  if (!row) return traced("moveAsset", "db_error", "The move was not recorded", null);
  return toAssetMovementDto(row);
}
