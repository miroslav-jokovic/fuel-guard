import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRIVER_STATUSES_THAT_HOLD_A_TRUCK,
  HOME_TIME_DEFAULTS,
  chunks,
  compareHomeTimes,
  homeTimeReturnRefusal,
  homeTimeStartRefusal,
  homeTimeState,
  homeTimeTimesRefusal,
  type HomeTimeChange,
  type HomeTimeDisposition,
  type HomeTimeDriverOption,
  type HomeTimeEndReason,
  type HomeTimeListResponse,
  type HomeTimeMark,
  type HomeTimePeriod,
  type HomeTimeSettings,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import { readFleetIdentities } from "../fleetIdentityReads.js";

/**
 * Home time — the period the office marks on a driver (`docs/plans/dispatch-loads/HOME-TIME-PLAN.md`
 * §3.1, step HT2). The rows are `driver_time_off` with `provider = 'silvicom'` (0597, D-HT1).
 *
 * ── EVERY QUERY NAMES THE CARRIER AND THE PROVIDER ───────────────────────────────────────────────
 * The service role bypasses RLS, so each read and write filters on `org_id` itself. Each also filters
 * on `provider = 'silvicom'`: the table can hold McLeod's windows too (`tmsIngest.ts`), which have no
 * return time and are not the office's to change.
 *
 * ── WHICH MOVES ARE FUNCTIONS ────────────────────────────────────────────────────────────────────
 * Mark and reopen are 0597's functions, because one live period per driver (D-HT3) needs their lock.
 * Change, end and cancel are ONE conditional UPDATE each — `end_at is null and canceled_at is null` in
 * the WHERE — so two people acting on one period cannot both win, and the table's shape CHECK holds
 * whatever is written. A conditional update that matches nothing means somebody closed it first, and
 * says so; it is never retried as a blind write.
 *
 * ── THE STATE IS NEVER STORED ────────────────────────────────────────────────────────────────────
 * `homeTimeState` reads it from the times against the caller's one clock (D-HT2).
 */

const TABLE = "driver_time_off";
const PROVIDER = "silvicom";
const COLUMNS =
  "id, driver_id, vehicle_id, start_at, expected_return_at, end_at, end_reason, canceled_at, truck_disposition, created_by, created_at, updated_at";
/** How many closed periods the tab's "Recently ended" shows, and how far back. */
const RECENT_LIMIT = 100;
const RECENT_DAYS = 60;
const DAY_MS = 86_400_000;

export interface HomeTimeRow {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  start_at: string;
  expected_return_at: string;
  end_at: string | null;
  end_reason: HomeTimeEndReason | null;
  canceled_at: string | null;
  truck_disposition: HomeTimeDisposition;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type HomeTimeRefusal =
  | { code: "not_found"; message: string }
  | { code: "invalid"; message: string }
  /** `existingId` names the live period a second one would have collided with (0597's HT010). */
  | { code: "conflict"; message: string; existingId?: string }
  | { code: "db_error"; message: string };

export const isHomeTimeRefusal = (v: unknown): v is HomeTimeRefusal =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

const dbError = (what: string): HomeTimeRefusal => ({ code: "db_error", message: `Could not ${what}` });
const CLOSED: HomeTimeRefusal = { code: "conflict", message: "This home time was already ended or canceled. Refresh to see it." };

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every live period of the carrier — scheduled, home or overdue. Bounded by the number of drivers, far
 * under PostgREST's 1,000-row cap; throws on a read error, so the board never shows "nobody is home"
 * because a read failed.
 */
export async function readLiveHomeTimes(admin: SupabaseClient, orgId: string): Promise<HomeTimeRow[]> {
  const { data, error } = await admin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .is("end_at", null)
    .is("canceled_at", null)
    .order("start_at", { ascending: false });
  if (error) throw new Error(`driver_time_off: ${error.message}`);
  return (data ?? []) as unknown as HomeTimeRow[];
}

/**
 * The carrier's alert thresholds, or `HOME_TIME_DEFAULTS` when it has saved none (0597 gives the
 * columns no default, so the numbers live in one place). Throws on a read error: a threshold that
 * silently fell back to the default would move an alert the carrier had set.
 */
export async function readHomeTimeSettings(admin: SupabaseClient, orgId: string): Promise<HomeTimeSettings> {
  const { data, error } = await admin
    .from("home_time_settings")
    .select("return_due_hours, overdue_after_hours, truck_limit_days")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`home_time_settings: ${error.message}`);
  const row = data as { return_due_hours: number; overdue_after_hours: number; truck_limit_days: number } | null;
  if (!row) return HOME_TIME_DEFAULTS;
  return { returnDueHours: row.return_due_hours, overdueAfterHours: row.overdue_after_hours, truckLimitDays: row.truck_limit_days };
}

/** Names for the ids a set of periods carries: drivers, trucks, and the people who marked them. */
async function hydrate(admin: SupabaseClient, orgId: string, rows: readonly HomeTimeRow[], now: Date): Promise<HomeTimePeriod[]> {
  const driverIds = [...new Set(rows.map((r) => r.driver_id).filter((id): id is string => !!id))];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id).filter((id): id is string => !!id))];
  const driverName = new Map<string, string>();
  const unitNumber = new Map<string, string>();
  // 50 ids a read (`chunks`): a longer `.in()` overflows Node 22's response headers.
  for (const ids of chunks(driverIds)) {
    const { data, error } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`drivers: ${error.message}`);
    for (const d of (data ?? []) as { id: string; full_name: string | null }[]) driverName.set(d.id, d.full_name ?? "Unnamed driver");
  }
  for (const ids of chunks(vehicleIds)) {
    const { data, error } = await admin.from("vehicles").select("id, unit_number").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`vehicles: ${error.message}`);
    for (const v of (data ?? []) as { id: string; unit_number: string | null }[]) if (v.unit_number) unitNumber.set(v.id, v.unit_number);
  }
  const people = await memberLabels(admin, orgId, rows.map((r) => r.created_by).filter((id): id is string => !!id));
  return rows
    // A period whose driver row is gone has nobody to show; the foreign key sets the id null.
    .filter((r): r is HomeTimeRow & { driver_id: string } => !!r.driver_id)
    .map((r) => ({
      id: r.id,
      driverId: r.driver_id,
      driverName: driverName.get(r.driver_id) ?? "Unnamed driver",
      vehicleId: r.vehicle_id,
      unitNumber: r.vehicle_id ? (unitNumber.get(r.vehicle_id) ?? null) : null,
      disposition: r.truck_disposition,
      startAt: r.start_at,
      expectedReturnAt: r.expected_return_at,
      endAt: r.end_at,
      endReason: r.end_reason,
      canceledAt: r.canceled_at,
      state: homeTimeState({ startAt: r.start_at, expectedReturnAt: r.expected_return_at, endAt: r.end_at, canceledAt: r.canceled_at }, now),
      markedByName: r.created_by ? labelOf(people.get(r.created_by)) : null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

async function getRow(admin: SupabaseClient, orgId: string, id: string): Promise<HomeTimeRow | null> {
  const { data, error } = await admin.from(TABLE).select(COLUMNS).eq("org_id", orgId).eq("provider", PROVIDER).eq("id", id).maybeSingle();
  if (error) throw new Error(`driver_time_off: ${error.message}`);
  return (data as unknown as HomeTimeRow | null) ?? null;
}

/** One period with its names, or null when it is not this carrier's. */
export async function getHomeTime(admin: SupabaseClient, orgId: string, id: string, now: Date): Promise<HomeTimePeriod | null> {
  const row = await getRow(admin, orgId, id);
  return row ? ((await hydrate(admin, orgId, [row], now))[0] ?? null) : null;
}

/**
 * The Home time tab: everyone scheduled, home or overdue in the tab's order, then what closed lately.
 *
 * Two reads, by what each must not miss. The live read has no window, because a period marked ten weeks
 * ago and never closed is exactly the one the tab exists to show. The recent read is the last
 * `RECENT_DAYS` of periods whatever their state; the live ones in it are dropped by id, so a period is
 * listed once.
 */
export async function listHomeTimes(admin: SupabaseClient, orgId: string, now: Date): Promise<HomeTimeListResponse> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  const [live, lately, settings] = await Promise.all([
    readLiveHomeTimes(admin, orgId),
    admin
      .from(TABLE)
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .gte("start_at", since)
      .order("start_at", { ascending: false })
      .limit(RECENT_LIMIT),
    readHomeTimeSettings(admin, orgId),
  ]);
  if (lately.error) throw new Error(`driver_time_off: ${lately.error.message}`);
  const liveIds = new Set(live.map((r) => r.id));
  const closed = ((lately.data ?? []) as unknown as HomeTimeRow[]).filter((r) => !liveIds.has(r.id) && (r.end_at !== null || r.canceled_at !== null));
  const periods = await hydrate(admin, orgId, [...live, ...closed], now);
  return {
    generatedAt: now.toISOString(),
    live: periods.filter((p) => liveIds.has(p.id)).sort(compareHomeTimes),
    recent: periods.filter((p) => !liveIds.has(p.id)).sort(compareHomeTimes),
    settings,
  };
}

/**
 * Who the form can be opened on from the Home time tab: every driver who may hold a truck
 * (`DRIVER_STATUSES_THAT_HOLD_A_TRUCK`), with the truck the roster pairs each to — either seat — and
 * the answer to "where is the truck" from that driver's previous period, to pre-select (plan §3.3).
 */
export async function listHomeTimeDrivers(admin: SupabaseClient, orgId: string): Promise<HomeTimeDriverOption[]> {
  const [drivers, identities, last] = await Promise.all([
    admin
      .from("drivers")
      .select("id, full_name")
      .eq("org_id", orgId)
      .in("status", [...DRIVER_STATUSES_THAT_HOLD_A_TRUCK])
      .is("archived_at", null)
      .order("full_name", { ascending: true })
      .limit(1000),
    readFleetIdentities(admin, orgId),
    admin
      .from(TABLE)
      .select("driver_id, truck_disposition, start_at")
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .is("canceled_at", null)
      .order("start_at", { ascending: false })
      .limit(1000),
  ]);
  if (drivers.error) throw new Error(`drivers: ${drivers.error.message}`);
  if (last.error) throw new Error(`driver_time_off: ${last.error.message}`);
  const truckOf = new Map<string, { vehicleId: string; unitNumber: string }>();
  for (const v of identities.byVehicleId.values()) {
    for (const seat of [v.driver, v.coDriver]) {
      if (seat && !truckOf.has(seat.id)) truckOf.set(seat.id, { vehicleId: v.vehicleId, unitNumber: v.unitNumber });
    }
  }
  // Newest first, so the first row seen for a driver is his latest period.
  const lastDisposition = new Map<string, HomeTimeDisposition>();
  for (const r of (last.data ?? []) as { driver_id: string | null; truck_disposition: HomeTimeDisposition }[]) {
    if (r.driver_id && !lastDisposition.has(r.driver_id)) lastDisposition.set(r.driver_id, r.truck_disposition);
  }
  return ((drivers.data ?? []) as { id: string; full_name: string | null }[]).map((d) => {
    const truck = truckOf.get(d.id) ?? null;
    const prior = lastDisposition.get(d.id) ?? null;
    return {
      driverId: d.id,
      driverName: d.full_name ?? "Unnamed driver",
      vehicleId: truck?.vehicleId ?? null,
      unitNumber: truck?.unitNumber ?? null,
      // A prior answer only pre-selects when it still fits: "no truck" for a driver who now has one does not.
      lastDisposition: prior && (prior === "no_truck") === (truck === null) ? prior : null,
    };
  });
}

// ── writes ────────────────────────────────────────────────────────────────────────────────────────

type DbError = { code?: string; details?: string | null; message?: string };

/** Mark a driver's home time. One live period per driver: a second is refused and names the first. */
export async function markHomeTime(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  input: HomeTimeMark,
  now: Date,
): Promise<HomeTimePeriod | HomeTimeRefusal> {
  const refusal = homeTimeTimesRefusal(input, now);
  if (refusal) return { code: "invalid", message: refusal };
  // Who may be marked is the roster's rule, read from the shared list; the function checks only the carrier.
  const { data: driver, error: driverError } = await admin
    .from("drivers")
    .select("id, status, archived_at")
    .eq("org_id", orgId)
    .eq("id", input.driverId)
    .maybeSingle();
  if (driverError) return dbError("read the driver");
  const d = driver as { status: string; archived_at: string | null } | null;
  if (!d) return { code: "not_found", message: "Driver not found" };
  if (d.archived_at !== null || !(DRIVER_STATUSES_THAT_HOLD_A_TRUCK as readonly string[]).includes(d.status)) {
    return { code: "invalid", message: "Home time is marked for drivers on the active roster." };
  }
  const { data, error } = await admin.rpc("home_time_mark", {
    p_org: orgId,
    p_driver: input.driverId,
    p_actor: actorId,
    p_start: new Date(input.startAt).toISOString(),
    p_expected_return: new Date(input.expectedReturnAt).toISOString(),
    p_disposition: input.disposition,
    p_vehicle: input.vehicleId,
  });
  if (error) {
    const e = error as DbError;
    if (e.code === "HT010") {
      return { code: "conflict", message: "This driver already has home time marked.", ...(e.details ? { existingId: e.details } : {}) };
    }
    if (e.code === "HT001") return { code: "not_found", message: "Driver not found" };
    if (e.code === "HT002") return { code: "not_found", message: "Truck not found" };
    if (e.code === "HT003" || e.code === "23514") return { code: "invalid", message: "Say where the truck is, and a return after the start." };
    return dbError("mark the home time");
  }
  const period = await getHomeTime(admin, orgId, String(data), now);
  return period ?? dbError("load the home time");
}

/** What a change moved, for the audit row: the field, its old value and its new one. */
export type HomeTimeChanged = Partial<Record<"startAt" | "expectedReturnAt" | "disposition", { from: string; to: string }>>;

/** A new return time, a corrected start, or the truck going back to the yard — on a live period only. */
export async function changeHomeTime(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  id: string,
  input: HomeTimeChange,
  now: Date,
): Promise<{ period: HomeTimePeriod; changed: HomeTimeChanged } | HomeTimeRefusal> {
  const row = await getRow(admin, orgId, id);
  if (!row) return { code: "not_found", message: "Home time not found" };
  if (row.end_at !== null || row.canceled_at !== null) return CLOSED;

  const startAt = input.startAt !== undefined ? new Date(input.startAt).toISOString() : row.start_at;
  const expectedReturnAt = input.expectedReturnAt !== undefined ? new Date(input.expectedReturnAt).toISOString() : row.expected_return_at;
  const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);
  const startMoved = !sameInstant(startAt, row.start_at);
  const returnMoved = !sameInstant(expectedReturnAt, row.expected_return_at);
  if (Date.parse(expectedReturnAt) <= Date.parse(startAt)) return { code: "invalid", message: "The return must be after the start" };
  // Only a time that MOVES is judged against the clock: an overdue period keeps its passed return while
  // somebody sends the truck back to the yard.
  const moved = (startMoved ? homeTimeStartRefusal(startAt, now) : null) ?? (returnMoved ? homeTimeReturnRefusal(expectedReturnAt, now) : null);
  if (moved) return { code: "invalid", message: moved };
  if (input.disposition !== undefined && row.truck_disposition === "no_truck") {
    return { code: "invalid", message: "This driver had no truck when the home time was marked." };
  }
  const disposition = input.disposition ?? row.truck_disposition;

  const changed: HomeTimeChanged = {};
  if (startMoved) changed.startAt = { from: row.start_at, to: startAt };
  if (returnMoved) changed.expectedReturnAt = { from: row.expected_return_at, to: expectedReturnAt };
  if (disposition !== row.truck_disposition) changed.disposition = { from: row.truck_disposition, to: disposition };
  if (Object.keys(changed).length === 0) {
    const same = (await hydrate(admin, orgId, [row], now))[0];
    return same ? { period: same, changed } : dbError("load the home time");
  }

  const { data, error } = await admin
    .from(TABLE)
    .update({ start_at: startAt, expected_return_at: expectedReturnAt, truck_disposition: disposition, updated_by: actorId, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .eq("id", id)
    .is("end_at", null)
    .is("canceled_at", null)
    .select(COLUMNS);
  if (error) return (error as DbError).code === "23514" ? { code: "invalid", message: "The return must be after the start" } : dbError("change the home time");
  const updated = ((data ?? []) as unknown as HomeTimeRow[])[0];
  if (!updated) return CLOSED;
  const period = (await hydrate(admin, orgId, [updated], now))[0];
  return period ? { period, changed } : dbError("load the home time");
}

/**
 * Close a live period that has started. `actorId` is null when the system ends it (D-HT6, the alert
 * job), and the reason says which: a person's "Back from home time" is `returned`.
 */
export async function endHomeTime(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  id: string,
  reason: HomeTimeEndReason,
  endAt: Date,
  now: Date,
): Promise<HomeTimePeriod | HomeTimeRefusal> {
  const row = await getRow(admin, orgId, id);
  if (!row) return { code: "not_found", message: "Home time not found" };
  if (row.end_at !== null || row.canceled_at !== null) return CLOSED;
  if (Date.parse(row.start_at) > now.getTime()) {
    return { code: "invalid", message: "This home time has not started yet. Cancel it instead." };
  }
  if (endAt.getTime() > now.getTime() || endAt.getTime() < Date.parse(row.start_at)) {
    return { code: "invalid", message: "The end must be between the start and now." };
  }
  const { data, error } = await admin
    .from(TABLE)
    .update({ end_at: endAt.toISOString(), end_reason: reason, ended_by: actorId, updated_by: actorId, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .eq("id", id)
    .is("end_at", null)
    .is("canceled_at", null)
    .select(COLUMNS);
  if (error) return dbError("end the home time");
  const updated = ((data ?? []) as unknown as HomeTimeRow[])[0];
  if (!updated) return CLOSED;
  return (await hydrate(admin, orgId, [updated], now))[0] ?? dbError("load the home time");
}

/** Marked by mistake: the row stays, signed, and counts for nothing (every reader skips canceled rows). */
export async function cancelHomeTime(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  id: string,
  now: Date,
): Promise<HomeTimePeriod | HomeTimeRefusal> {
  const { data, error } = await admin
    .from(TABLE)
    .update({ canceled_at: now.toISOString(), canceled_by: actorId, updated_by: actorId, updated_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .eq("id", id)
    .is("end_at", null)
    .is("canceled_at", null)
    .select(COLUMNS);
  if (error) return dbError("cancel the home time");
  const updated = ((data ?? []) as unknown as HomeTimeRow[])[0];
  if (!updated) return (await getRow(admin, orgId, id)) ? CLOSED : { code: "not_found", message: "Home time not found" };
  return (await hydrate(admin, orgId, [updated], now))[0] ?? dbError("load the home time");
}

/** Undo an end — a person's, or the system's on load evidence (D-HT6). */
export async function reopenHomeTime(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  id: string,
  now: Date,
): Promise<HomeTimePeriod | HomeTimeRefusal> {
  const { error } = await admin.rpc("home_time_reopen", { p_org: orgId, p_id: id, p_actor: actorId });
  if (error) {
    const e = error as DbError;
    if (e.code === "HT020") return { code: "not_found", message: "Home time not found" };
    if (e.code === "HT011") return { code: "conflict", message: "Only an ended home time can be reopened." };
    if (e.code === "HT010") {
      return { code: "conflict", message: "This driver has newer home time marked. End or cancel that one first.", ...(e.details ? { existingId: e.details } : {}) };
    }
    return dbError("reopen the home time");
  }
  return (await getHomeTime(admin, orgId, id, now)) ?? dbError("load the home time");
}
