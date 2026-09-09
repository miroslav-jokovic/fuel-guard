import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountSessionDto, CountSessionInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * Count sessions — one walk of one place (INVENTORY-PLAN.md step I5 PR 1, D-INV19/20).
 *
 * ── THE ENTRIES ARE NOT IN THIS FILE, AND THERE IS NO ENTRIES TABLE ────────────────────────────
 * A count entry IS a `counted` row in `part_movements` carrying this session's id, so the ledger's
 * variance and the review screen's variance cannot disagree: there is one number and one row.
 * Reading a session's entries is `listMovements({ countSessionId })`, which already exists — adding
 * a second reader here would be a second answer to one question.
 *
 * ── CLOSING IS THE ONLY UPDATE, AND THE DATABASE IS WHAT SAYS SO ───────────────────────────────
 * 0332's trigger refuses every other change and refuses a second close (`IV017`), for the service
 * role too. That matters because this module holds the service key and bypasses RLS, so the policy
 * on its own would leave a closed session editable by the one caller that can reach it. `closeSession`
 * below therefore does not check whether the session is already closed before writing: it writes and
 * reads the refusal, which is the only version that cannot race a second phone.
 *
 * ── `holderLabel` IS RESOLVED, NOT STORED ──────────────────────────────────────────────────────
 * The DTO carries a human name for whichever holder the session is about — a bay, a truck, a
 * trailer. It is joined at read time rather than copied onto the row, because a bay that gets
 * renamed should not leave last month's sessions pointing at a name nobody uses. Same reasoning as
 * `actorName` on a movement, which the 2026-09-09 review had to add for exactly this shape.
 */

const COLUMNS =
  "id, kind, location_id, vehicle_id, trailer_id, started_by, blind, status, opened_at, closed_at, note, " +
  "stock_locations(name), vehicles(unit_number), trailers(unit_number)";

interface SessionRow {
  id: string;
  kind: CountSessionDto["kind"];
  location_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  started_by: string | null;
  blind: boolean;
  status: CountSessionDto["status"];
  opened_at: string;
  closed_at: string | null;
  note: string | null;
  stock_locations: { name: string } | null;
  vehicles: { unit_number: string | null } | null;
  trailers: { unit_number: string | null } | null;
}

/** The bay's name, or the unit number of the truck or trailer. Null only if the join found nothing. */
const holderLabelOf = (r: SessionRow): string | null =>
  r.stock_locations?.name ?? r.vehicles?.unit_number ?? r.trailers?.unit_number ?? null;

export const toCountSessionDto = (r: SessionRow, startedByName: string | null = null): CountSessionDto => ({
  id: r.id,
  kind: r.kind,
  locationId: r.location_id,
  vehicleId: r.vehicle_id,
  trailerId: r.trailer_id,
  holderLabel: holderLabelOf(r),
  startedBy: r.started_by,
  startedByName,
  blind: r.blind,
  status: r.status,
  openedAt: r.opened_at,
  closedAt: r.closed_at,
  note: r.note,
});

export interface ListSessionsOptions {
  status?: CountSessionDto["status"];
  kind?: CountSessionDto["kind"];
  locationId?: string;
  limit?: number;
  offset?: number;
}

/**
 * One page of sessions, newest first.
 *
 * Names are resolved with ONE directory call for the page rather than one per row, which is the
 * shape `lib/memberLabels` exists to enforce.
 */
export async function listCountSessions(
  admin: SupabaseClient,
  orgId: string,
  opts: ListSessionsOptions = {},
): Promise<{ sessions: CountSessionDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("stock_count_sessions").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);

  const { data, error, count } = await q
    .order("opened_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return traced("listCountSessions", "db_error", "Could not load count sessions", error);

  const rows = (data ?? []) as unknown as SessionRow[];
  const labels = await memberLabels(
    admin,
    orgId,
    rows.map((r) => r.started_by).filter((id): id is string => Boolean(id)),
  );
  return {
    sessions: rows.map((r) => toCountSessionDto(r, r.started_by ? labelOf(labels.get(r.started_by)) : null)),
    total: count ?? 0,
  };
}

export async function getCountSession(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<CountSessionDto | null | ServiceError> {
  const { data, error } = await admin
    .from("stock_count_sessions")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return traced("getCountSession", "db_error", "Could not load the count session", error);
  if (!data) return null;

  const row = data as unknown as SessionRow;
  const labels = await memberLabels(admin, orgId, row.started_by ? [row.started_by] : []);
  return toCountSessionDto(row, row.started_by ? labelOf(labels.get(row.started_by)) : null);
}

/**
 * Open a walk.
 *
 * ⚠ The id is the SERVER's, unlike a movement's. D-INV27 makes a movement idempotent on a
 * client-generated UUID because a movement is what the phone queues while the bay has no signal;
 * a session is opened at the desk or on arrival, with the network up, because the screen cannot
 * show what to count without it. A client-generated session id would buy nothing and would let two
 * taps of Start produce two walks with the same id and different holders.
 *
 * `blind` is taken from the caller and not defaulted here: D-INV20 makes blind the default, and the
 * column carries it, but a caller that deliberately reveals must be recorded as having done so.
 */
export async function openCountSession(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  input: CountSessionInput,
): Promise<CountSessionDto | ServiceError> {
  const { data, error } = await admin
    .from("stock_count_sessions")
    .insert({
      org_id: orgId,
      kind: input.kind,
      location_id: input.locationId ?? null,
      vehicle_id: input.vehicleId ?? null,
      trailer_id: input.trailerId ?? null,
      started_by: actorId,
      blind: input.blind,
      note: input.note ?? null,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    // 23503: the bay, truck or trailer is not this org's, or does not exist. The FK is the check —
    // the same one `updateStockLine` reads, and the reason neither has to query first.
    if (error.code === "23503") {
      return { error: "That location or unit is not available.", code: "IV012" };
    }
    // 23514: a CHECK refused it — two holders, none, or a `kind` that disagrees with the holder.
    // The schema is the authority on that rule, so the message names the rule rather than guessing
    // which half of it the caller broke.
    //
    // ⚠ Deliberately NOT a new `IV018`. The `IV0xx` numbers in this module are SQLSTATEs some
    // migration actually raises (`IV017` below is 0332's trigger), and minting one that no SQL
    // raises would make the next reader grep for it and find nothing. `IV012` above is the
    // exception the house already makes — `stockSettings.ts` maps 23503 to it the same way — and
    // that is a synthesised code for a real SQLSTATE, not a fictional SQLSTATE.
    if (error.code === "23514") {
      return { error: "A count is about exactly one place — a location, a truck, or a trailer.", code: "malformed_session" };
    }
    return traced("openCountSession", "db_error", "Could not open the count session", error);
  }

  const row = data as unknown as SessionRow;
  const labels = await memberLabels(admin, orgId, actorId ? [actorId] : []);
  return toCountSessionDto(row, actorId ? labelOf(labels.get(actorId)) : null);
}

/**
 * Close a walk. Irreversible, and the trigger is what makes that true rather than this function.
 *
 * The org filter is on the UPDATE and not on a read before it, so a session belonging to another org
 * matches no row and is reported as gone rather than refused — which is the same answer a caller
 * gets for an id that never existed, and is the answer they should get.
 */
export async function closeCountSession(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  note?: string | null,
): Promise<CountSessionDto | null | ServiceError> {
  const patch: Record<string, unknown> = { status: "closed", closed_at: new Date().toISOString() };
  if (note !== undefined) patch.note = note;

  const { data, error } = await admin
    .from("stock_count_sessions")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "IV017") {
      return { error: "That count is already closed. A correction is a new count.", code: "IV017" };
    }
    return traced("closeCountSession", "db_error", "Could not close the count session", error);
  }
  if (!data) return null;

  const row = data as unknown as SessionRow;
  const labels = await memberLabels(admin, orgId, row.started_by ? [row.started_by] : []);
  return toCountSessionDto(row, row.started_by ? labelOf(labels.get(row.started_by)) : null);
}
