import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ChangeEquipmentRequest,
  type DutySession,
  type EndShiftRequest,
  type EquipmentConflict,
  type EquipmentOption,
  type MeEquipmentResponse,
  type StartShiftRequest,
} from "@silvicom/shared";

/**
 * Duty sessions — the driver-scoped equipment truth (Driver App Phase 3A, migration 0086, D43/D44).
 *
 * Every mutation here delegates to a `security definer` Postgres function, NOT to a sequence of
 * supabase-js calls. Opening a shift writes a session AND its first segment, and a take-over closes
 * another driver's rows in the same breath; supabase-js cannot span a transaction, so a two-step
 * write would leave orphan sessions the moment the second call failed. The functions also make the
 * exclusive-equipment check race-free, since the partial unique indexes and the check live inside one
 * transaction.
 *
 * Identity is ALWAYS the caller's, resolved from the verified JWT by the route — never from the body.
 */

/** Custom SQLSTATEs raised by 0086, mapped to the API's conflict vocabulary. */
const PG_ERROR_TO_CONFLICT: Record<string, EquipmentConflict["code"]> = {
  DG001: "vehicle_in_use",
  DG002: "trailer_in_use",
  DG003: "shift_already_open",
};
const PG_EQUIPMENT_NOT_FOUND = "DG005";
const PG_NO_ACTIVE_SHIFT = "DG004";

export type DutyResult =
  | { ok: true; session: DutySession | null }
  | { ok: false; status: 404 | 409; code: string; message: string; conflict?: EquipmentConflict };

interface PgLikeError {
  code?: string | null;
  message?: string | null;
}

/** Resolve the roster driver behind a login. Returns null when no `drivers` row is linked (D3). */
export async function resolveDriverId(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("drivers")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    // ── THE STATUS GATE ────────────────────────────────────────────────────────────────────────
    // Only a CURRENTLY EMPLOYED driver may act as one. Without this line a terminated driver whose
    // app credential was never explicitly revoked could still accept loads, open a duty session and
    // complete stops.
    //
    // It is easy to believe RLS already covered this, and that belief is why the gap survived:
    // `auth_driver_id()` (0083) does require `status = 'active'`, but it reads the caller's JWT and
    // therefore only guards DIRECT client reads. The driver app does not take that path — every
    // /api/me route resolves through here and then queries with the SERVICE ROLE, which bypasses RLS
    // entirely. 0141 moved the driver load mutations onto that same service-role path and its header
    // says the safety "is not dropped, it is made explicit: every function now verifies that
    // `p_driver` is a live driver row"; `assert_driver_load` in fact verifies only that the driver is
    // in the org. So between them the status check was lost on the one path the app actually uses.
    //
    // Matching `auth_driver_id()` exactly — 'active', not "not terminated" — keeps the two answers
    // identical rather than merely similar, which is what stops this drifting apart again.
    //
    // Measured before the change (2026-08-24): of 271 drivers exactly one had a login, and they were
    // active, so nobody is locked out by this. The exposure was latent, and the milestone that
    // automates termination for 164 drivers (roster sync M6) is what would have made it live.
    //
    // Every caller already renders a null as `404 no_driver_record`, so a gated session gets a clean
    // refusal rather than a crash.
    .eq("status", "active")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * The check-in pick list. Served with the service role and a deliberately minimal projection,
 * because RLS keeps the vehicle/trailer roster closed to drivers (0086) — a driver must be able to
 * CHOOSE a truck without being handed the fleet's odometers, tank capacities or cost basis.
 *
 * `in_use_by` comes from the open segments, so the sheet can warn before the 409 instead of after.
 */
export async function getEquipmentPickList(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<MeEquipmentResponse> {
  const [vehicles, trailers, held] = await Promise.all([
    admin
      .from("vehicles")
      .select("id, unit_number, make, model, status, assigned_driver_id")
      .eq("org_id", orgId)
      .order("unit_number", { ascending: true }),
    admin
      .from("trailers")
      .select("id, unit_number, make, model, status")
      .eq("org_id", orgId)
      .order("unit_number", { ascending: true }),
    admin
      .from("duty_equipment_segments")
      .select("vehicle_id, trailer_id, from_at, drivers!inner(full_name)")
      .eq("org_id", orgId)
      .is("to_at", null)
      .eq("seat", "driver"),
  ]);

  if (vehicles.error) throw new Error(`Could not load fleet vehicles: ${vehicles.error.message}`);
  if (trailers.error) throw new Error(`Could not load fleet trailers: ${trailers.error.message}`);
  if (held.error) throw new Error(`Could not load active equipment assignments: ${held.error.message}`);

  type HeldRow = {
    vehicle_id: string | null;
    trailer_id: string | null;
    from_at: string;
    drivers: { full_name: string } | { full_name: string }[] | null;
  };
  const holderName = (row: HeldRow): string | null => {
    const d = Array.isArray(row.drivers) ? row.drivers[0] : row.drivers;
    return d?.full_name ?? null;
  };

  const byVehicle = new Map<string, { name: string | null; since: string }>();
  const byTrailer = new Map<string, { name: string | null; since: string }>();
  for (const row of (held.data ?? []) as HeldRow[]) {
    if (row.vehicle_id) byVehicle.set(row.vehicle_id, { name: holderName(row), since: row.from_at });
    if (row.trailer_id) byTrailer.set(row.trailer_id, { name: holderName(row), since: row.from_at });
  }

  type AssetRow = {
    id: string;
    unit_number: string;
    make: string | null;
    model: string | null;
    status: string | null;
    assigned_driver_id?: string | null;
  };

  const toOption = (
    row: AssetRow,
    heldBy: Map<string, { name: string | null; since: string }>,
  ): EquipmentOption => {
    const hold = heldBy.get(row.id);
    return {
      id: row.id,
      unit_number: row.unit_number,
      make: row.make ?? null,
      model: row.model ?? null,
      in_use_by: hold?.name ?? null,
      in_use_since: hold?.since ?? null,
      is_default: row.assigned_driver_id === driverId,
    };
  };

  // Retired equipment is not selectable; anything in maintenance still is, because a driver moving a
  // unit to the shop is exactly when a check-in matters.
  const selectable = (row: AssetRow) => (row.status ?? "active") !== "retired";

  return {
    vehicles: ((vehicles.data ?? []) as AssetRow[]).filter(selectable).map((r) => toOption(r, byVehicle)),
    trailers: ((trailers.data ?? []) as AssetRow[]).filter(selectable).map((r) => toOption(r, byTrailer)),
  };
}

/** The driver's active shift with its segments (oldest first), or null when they are off duty. */
export async function getActiveSession(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<DutySession | null> {
  const { data } = await admin
    .from("driver_duty_sessions")
    .select("id, driver_id, started_at, ended_at, ended_reason, start_odometer, end_odometer, source")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("ended_at", null)
    .maybeSingle();
  if (!data) return null;
  return hydrateSession(admin, orgId, data as Omit<DutySession, "segments">);
}

/** Attach the segments + unit numbers so the app renders "Unit 214 · Trailer 5521" with no waterfall (D29). */
async function hydrateSession(
  admin: SupabaseClient,
  orgId: string,
  session: Omit<DutySession, "segments">,
): Promise<DutySession> {
  const { data } = await admin
    .from("duty_equipment_segments")
    .select(
      "id, vehicle_id, trailer_id, seat, from_at, to_at, confirmed_by, note, vehicles(unit_number), trailers(unit_number)",
    )
    .eq("org_id", orgId)
    .eq("session_id", session.id)
    .order("from_at", { ascending: true });

  type Unit = { unit_number: string } | { unit_number: string }[] | null;
  const unit = (u: Unit): string | null => (Array.isArray(u) ? (u[0]?.unit_number ?? null) : (u?.unit_number ?? null));

  type SegRow = {
    id: string;
    vehicle_id: string;
    trailer_id: string | null;
    seat: "driver" | "co_driver";
    from_at: string;
    to_at: string | null;
    confirmed_by: "driver" | "dispatch";
    note: string | null;
    vehicles: Unit;
    trailers: Unit;
  };

  return {
    ...session,
    segments: ((data ?? []) as SegRow[]).map((s) => ({
      id: s.id,
      vehicle_id: s.vehicle_id,
      vehicle_unit: unit(s.vehicles),
      trailer_id: s.trailer_id,
      trailer_unit: unit(s.trailers),
      seat: s.seat,
      from_at: s.from_at,
      to_at: s.to_at,
      confirmed_by: s.confirmed_by,
      note: s.note,
    })),
  };
}

/**
 * Build the 409 body a conflict sheet renders verbatim — which unit, who has it, since when. The
 * driver has to see this before `take_over` is allowed (D44.6): a silent steal would corrupt a week
 * of fuel and idle attribution for two drivers at once.
 */
async function describeConflict(
  admin: SupabaseClient,
  orgId: string,
  code: EquipmentConflict["code"],
  assetId: string | null | undefined,
): Promise<EquipmentConflict> {
  const empty: EquipmentConflict = { code, unit_number: null, held_by: null, held_since: null };
  if (code === "shift_already_open" || !assetId) return empty;

  const table = code === "vehicle_in_use" ? "vehicles" : "trailers";
  const column = code === "vehicle_in_use" ? "vehicle_id" : "trailer_id";

  const [asset, seg] = await Promise.all([
    admin.from(table).select("unit_number").eq("id", assetId).maybeSingle(),
    admin
      .from("duty_equipment_segments")
      .select("from_at, drivers!inner(full_name)")
      .eq("org_id", orgId)
      .eq(column, assetId)
      .is("to_at", null)
      .eq("seat", "driver")
      .maybeSingle(),
  ]);

  const drivers = (seg.data as { drivers?: { full_name: string } | { full_name: string }[] } | null)?.drivers;
  const holder = Array.isArray(drivers) ? drivers[0] : drivers;

  return {
    code,
    unit_number: (asset.data as { unit_number?: string } | null)?.unit_number ?? null,
    held_by: holder?.full_name ?? null,
    held_since: (seg.data as { from_at?: string } | null)?.from_at ?? null,
  };
}

/** Translate a raised SQLSTATE from 0086 into the route's response, or null if it isn't ours. */
async function toDutyError(
  admin: SupabaseClient,
  orgId: string,
  error: PgLikeError,
  assets: { vehicle_id?: string | null; trailer_id?: string | null },
): Promise<DutyResult | null> {
  const code = error.code ?? "";
  const conflictCode = PG_ERROR_TO_CONFLICT[code];
  if (conflictCode) {
    const assetId = conflictCode === "vehicle_in_use" ? assets.vehicle_id : assets.trailer_id;
    const conflict = await describeConflict(admin, orgId, conflictCode, assetId);
    return {
      ok: false,
      status: 409,
      code: conflictCode,
      message:
        conflictCode === "shift_already_open"
          ? "You already have an open shift"
          : `${conflict.unit_number ? `Unit ${conflict.unit_number}` : "That unit"} is already checked out`,
      conflict,
    };
  }
  if (code === PG_EQUIPMENT_NOT_FOUND) {
    return { ok: false, status: 404, code: "equipment_not_found", message: "That unit is not in your fleet" };
  }
  if (code === PG_NO_ACTIVE_SHIFT) {
    return { ok: false, status: 409, code: "no_active_shift", message: "Confirm your truck first" };
  }
  return null;
}

/**
 * Open a shift. `session_id` / `segment_id` are the CLIENT UUIDs from the outbox and become the row
 * primary keys, so a queued offline check-in that drains twice returns the same shift rather than
 * opening a second one.
 */
export async function startShift(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  input: StartShiftRequest,
): Promise<DutyResult> {
  const { error } = await admin.rpc("start_duty_session", {
    p_org: orgId,
    p_driver: driverId,
    p_session: input.session_id,
    p_segment: input.segment_id,
    p_vehicle: input.vehicle_id,
    p_trailer: input.trailer_id ?? null,
    p_odometer: input.start_odometer ?? null,
    p_started_at: input.started_at ?? null,
    p_device_id: input.device_id ?? null,
    p_take_over: input.take_over,
  });
  if (error) {
    const mapped = await toDutyError(admin, orgId, error, input);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  return { ok: true, session: await getActiveSession(admin, orgId, driverId) };
}

/** Drop-and-hook / truck swap. Closes the current segment and opens a new one — never ends the shift. */
export async function changeEquipment(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  input: ChangeEquipmentRequest,
): Promise<DutyResult> {
  const { error } = await admin.rpc("change_duty_equipment", {
    p_org: orgId,
    p_driver: driverId,
    p_segment: input.segment_id,
    p_vehicle: input.vehicle_id ?? null,
    p_trailer: input.trailer_id ?? null,
    p_clear_trailer: input.clear_trailer,
    p_from_at: input.from_at ?? null,
    p_note: input.note ?? null,
    p_take_over: input.take_over,
  });
  if (error) {
    const mapped = await toDutyError(admin, orgId, error, input);
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  return { ok: true, session: await getActiveSession(admin, orgId, driverId) };
}

/** Sign off. Idempotent — an offline sign-off that drains twice is a no-op, not an error. */
export async function endShift(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  input: EndShiftRequest,
): Promise<DutyResult> {
  const { error } = await admin.rpc("end_duty_session", {
    p_org: orgId,
    p_driver: driverId,
    p_ended_at: input.ended_at ?? null,
    p_odometer: input.end_odometer ?? null,
    p_reason: "driver",
  });
  if (error) {
    const mapped = await toDutyError(admin, orgId, error, {});
    if (mapped) return mapped;
    throw new Error(error.message);
  }
  return { ok: true, session: null };
}

/**
 * The D44.5 sweeper. REQUIRED, not a nicety: the exclusive-vehicle index makes a truck belong to its
 * current holder, so without this the first driver who forgets to sign off locks that unit out of the
 * fleet indefinitely. `ended_reason = 'auto_timeout'` keeps an auto-close distinguishable from a real
 * sign-off, so it never quietly pollutes attribution analysis.
 */
export async function closeStaleDutySessions(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc("close_stale_duty_sessions");
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}
