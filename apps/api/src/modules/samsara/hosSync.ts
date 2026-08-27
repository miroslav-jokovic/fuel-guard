import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseHosLogs,
  parseHosClocks,
  parseVehicleGpsSnapshots,
  cityFromFormattedLocation,
  type VehicleGpsSnapshot,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { loadSamsaraToken } from "../../lib/samsaraToken.js";
import {
  makeSamsaraHosLogsFetcher,
  makeSamsaraHosClocksFetcher,
  makeSamsaraGpsSnapshotFetcher,
  type SamsaraHosLogsFetcher,
  type SamsaraHosClocksFetcher,
  type SamsaraGpsSnapshotFetcher,
} from "../../lib/samsara.js";
import { NoSamsaraTokenError } from "../samsara/index.js";
import { IDLE_SOURCE_WINDOW_DAYS } from "../idle/index.js";

export interface HosSyncResult {
  fetched: number; // duty-status segments parsed from the window
  upserted: number; // segments actually WRITTEN (new or changed) — unchanged rows are skipped
  /** Stale segments deleted because the authoritative fetch no longer contains them (edited logs). */
  removed: number;
}

const UPSERT_CHUNK = 500;
/** Rows per page when reading back the window's existing segments (PostgREST caps a select at 1000). */
const READ_PAGE = 1000;
/** Fetch /fleet/hos/logs in bounded windows — a single fleet-wide multi-week request is what made Samsara
 *  time out (500/504) on the idle feed; 7-day windows answer reliably (same fix as idleSync). */
const HOS_FETCH_CHUNK_DAYS = 7;
/**
 * Default trailing window. The idling UI and parked-session evidence both operate on 30 days, so HOS must
 * cover the same range or older idle sessions remain permanently unsupported. Requests are still split into
 * 7-day Samsara calls below, and diff-before-write keeps steady-state database writes bounded.
 */
const DEFAULT_SINCE_DAYS = IDLE_SOURCE_WINDOW_DAYS;

/**
 * If Samsara returned per-driver items but NONE parsed into segments, the nested-log field names differ from
 * what parseHosLogs expects. Log the STRUCTURE (keys only — never values, which are driver PII) once so a
 * shape drift surfaces loudly instead of silently syncing nothing. This is the live-shape assertion promised
 * in the plan for the one field the public docs didn't pin down.
 */
function warnOnShapeMismatch(rawData: unknown[], segmentCount: number): void {
  if (rawData.length === 0 || segmentCount > 0) return;
  const first = rawData[0] as Record<string, unknown> | null;
  const itemKeys = first ? Object.keys(first) : [];
  const logsArr = first
    ? ((first as { hosLogs?: unknown[]; logs?: unknown[] }).hosLogs ??
      (first as { logs?: unknown[] }).logs)
    : undefined;
  const logs = Array.isArray(logsArr) ? logsArr : [];
  const logKeys =
    logs.length && logs[0] && typeof logs[0] === "object" ? Object.keys(logs[0] as object) : [];
  console.warn(
    `[hosSync] Samsara returned ${rawData.length} HOS item(s) but 0 segments parsed — likely a response-shape ` +
      `drift. item keys=[${itemKeys.join(",")}] log keys=[${logKeys.join(",")}]. ` +
      `Update parseHosLogs field mapping in packages/shared/src/hos.ts.`,
  );
}

/** Fetch /fleet/hos/logs over [startMs, endMs) in HOS_FETCH_CHUNK_DAYS windows and merge the raw data.
 *  parseHosLogs de-dupes per driver by log start, so an entry recurring at a chunk edge never doubles. */
async function fetchHosLogsChunked(
  fetchHos: SamsaraHosLogsFetcher,
  startMs: number,
  endMs: number,
): Promise<unknown[]> {
  const CHUNK_MS = HOS_FETCH_CHUNK_DAYS * 86_400_000;
  const rawData: unknown[] = [];
  for (let s = startMs; s < endMs; s += CHUNK_MS) {
    const e = Math.min(s + CHUNK_MS, endMs);
    const chunk = await fetchHos(new Date(s).toISOString(), new Date(e).toISOString());
    if (Array.isArray(chunk.data)) rawData.push(...chunk.data);
  }
  return rawData;
}

interface ExistingSegment {
  id: string;
  driver_id: string | null;
  status: string;
  ended_at: string | null;
  samsara_vehicle_id: string | null;
  vehicle_id: string | null;
}

/** Read back the window's already-stored segments, keyed by `samsara_driver_id|startMs` — the diff basis
 *  that lets the sync skip unchanged rows instead of rewriting the whole window every run. Paged, ordered
 *  on (started_at, id) to match idx_hos_seg_org_time. */
async function loadExistingSegments(
  admin: SupabaseClient,
  orgId: string,
  startIso: string,
  endIso: string,
): Promise<Map<string, ExistingSegment>> {
  const out = new Map<string, ExistingSegment>();
  for (let offset = 0; ; offset += READ_PAGE) {
    const { data, error } = await admin
      .from("hos_duty_segments")
      .select(
        "id, samsara_driver_id, driver_id, status, started_at, ended_at, samsara_vehicle_id, vehicle_id",
      )
      .eq("org_id", orgId)
      .gte("started_at", startIso)
      .lte("started_at", endIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + READ_PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as (ExistingSegment & {
      samsara_driver_id: string;
      started_at: string;
    })[];
    for (const r of batch) {
      out.set(`${r.samsara_driver_id}|${Date.parse(r.started_at)}`, {
        id: r.id,
        driver_id: r.driver_id,
        status: r.status,
        ended_at: r.ended_at,
        samsara_vehicle_id: r.samsara_vehicle_id ?? null,
        vehicle_id: r.vehicle_id ?? null,
      });
    }
    if (batch.length < READ_PAGE) break;
  }
  return out;
}

/** True when the stored row already matches this segment (status, end, driver link, and logbook vehicle) —
 *  nothing to write. A resolved driver/vehicle never gets UNLINKED by a null resolution (e.g. a driver
 *  deactivated mid-window, or a log entry without a vehicle ref). */
function segmentUnchanged(
  existing: ExistingSegment | undefined,
  status: string,
  endMs: number | null,
  driverId: string | null,
  samsaraVehicleId: string | null,
): boolean {
  if (!existing) return false;
  if (existing.status !== status) return false;
  const exEnd = existing.ended_at != null ? Date.parse(existing.ended_at) : null;
  if (exEnd !== endMs) return false;
  if (samsaraVehicleId != null && existing.samsara_vehicle_id !== samsaraVehicleId) return false;
  return driverId == null || existing.driver_id === driverId;
}

/**
 * Pull Samsara HOS duty-status logs over the trailing window, normalize to contiguous duty-status segments,
 * resolve each to our driver (via samsara_driver_id), and upsert into hos_duty_segments. Idempotent on
 * (org_id, samsara_driver_id, started_at) — a re-sync closes previously-open segments (refreshes ended_at)
 * and links a driver_id that matched late. Segments are stored per DRIVER; the idle overlay joins them to a
 * truck via the driver↔vehicle assignment at the time.
 *
 * Writes are DIFFED: the window's stored rows are read back first and only new/changed segments are
 * upserted. Before this, every run rewrote the full window (fresh `updated_at` on every row), which bloated
 * the table past 500k rows until upserts exceeded Postgres' statement timeout and the job failed.
 */
export async function syncHosDutySegments(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: {
    sinceDays?: number;
    startIso?: string;
    endIso?: string;
    hosFetcher?: SamsaraHosLogsFetcher;
  } = {},
): Promise<HosSyncResult> {
  const token = opts.hosFetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const days = opts.sinceDays ?? DEFAULT_SINCE_DAYS;
  const endIso = opts.endIso ?? new Date().toISOString();
  const startIso = opts.startIso ?? new Date(Date.parse(endIso) - days * 86_400_000).toISOString();

  const fetchHos = opts.hosFetcher ?? makeSamsaraHosLogsFetcher(env, token);
  const rawData = await fetchHosLogsChunked(fetchHos, Date.parse(startIso), Date.parse(endIso));
  const segments = parseHosLogs(rawData, { windowEndMs: Date.parse(endIso) });
  warnOnShapeMismatch(rawData, segments.length);
  if (segments.length === 0) return { fetched: 0, upserted: 0, removed: 0 };

  // Resolve Samsara driver id → our driver id (unresolved stays null; the segment is still stored so a later
  // driver match can link it, and On-Duty/rest attribution is not lost).
  const { data: ds } = await admin
    .from("drivers")
    .select("id, samsara_driver_id")
    .eq("org_id", orgId)
    .not("samsara_driver_id", "is", null);
  const drvBySamsara = new Map(
    ((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [
      d.samsara_driver_id,
      d.id,
    ]),
  );

  // Resolve Samsara vehicle id → our vehicles.id (WP-ATTR — the per-log LOGBOOK truck). Unresolved ids
  // still store the raw samsara_vehicle_id so a later vehicle link can resolve them.
  const { data: vs } = await admin
    .from("vehicles")
    .select("id, samsara_vehicle_id")
    .eq("org_id", orgId)
    .not("samsara_vehicle_id", "is", null);
  const vehBySamsara = new Map(
    ((vs ?? []) as { id: string; samsara_vehicle_id: string }[]).map((v) => [
      v.samsara_vehicle_id,
      v.id,
    ]),
  );

  // Diff against what's already stored — only new/changed segments get written.
  const existing = await loadExistingSegments(admin, orgId, startIso, endIso);
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const s of segments) {
    const resolved = drvBySamsara.get(s.driverId) ?? null;
    const segVehicle = s.vehicleId ?? null;
    const resolvedVehicle = segVehicle != null ? (vehBySamsara.get(segVehicle) ?? null) : null;
    const ex = existing.get(`${s.driverId}|${s.startMs}`);
    if (segmentUnchanged(ex, s.status, s.endMs, resolved, segVehicle)) continue;
    rows.push({
      org_id: orgId,
      // Never unlink on a null resolution — keep an already-linked driver_id / vehicle.
      driver_id: resolved ?? ex?.driver_id ?? null,
      samsara_driver_id: s.driverId,
      status: s.status,
      started_at: new Date(s.startMs).toISOString(),
      ended_at: s.endMs != null ? new Date(s.endMs).toISOString() : null,
      samsara_vehicle_id: segVehicle ?? ex?.samsara_vehicle_id ?? null,
      vehicle_id: resolvedVehicle ?? ex?.vehicle_id ?? null,
      updated_at: now,
    });
  }

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("hos_duty_segments")
      .upsert(chunk, { onConflict: "org_id,samsara_driver_id,started_at" });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }

  // P1 (2026-08 audit) — ORPHAN REMOVAL. The upsert key is (org, driver, started_at), so when a
  // driver/admin EDITS an ELD log and a segment's start shifts (routine), the re-sync inserts the
  // new row and the STALE one stays — overlapping duplicate segments that feed verifyFillAttribution
  // and isDriverOffDutyAtFill with contradictory timelines. Samsara's response is authoritative for
  // the fetched window, so a stored segment in that window that the response no longer contains is
  // deleted — but ONLY for drivers actually present in this response: a driver missing from the
  // fetch (pagination hiccup, permissions change) must never have their history wiped by silence.
  const fetchedKeys = new Set(segments.map((s) => `${s.driverId}|${s.startMs}`));
  const fetchedDrivers = new Set(segments.map((s) => s.driverId));
  const orphanIds: string[] = [];
  for (const [key, ex] of existing) {
    const driverKey = key.slice(0, key.lastIndexOf("|"));
    if (fetchedDrivers.has(driverKey) && !fetchedKeys.has(key)) orphanIds.push(ex.id);
  }
  let removed = 0;
  for (let i = 0; i < orphanIds.length; i += UPSERT_CHUNK) {
    const chunk = orphanIds.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("hos_duty_segments")
      .delete()
      .in("id", chunk)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    removed += chunk.length;
  }
  return { fetched: segments.length, upserted, removed };
}

export interface HosCurrentStatusResult {
  drivers: number; // driver rows whose live HOS status was refreshed
  located: number; // of those, how many also got a current city location
}

/**
 * Best-effort fleet GPS snapshot (one paginated /fleet/vehicles/stats?types=gps call). Samsara decorates
 * each fix with its own reverse-geocoded `formattedLocation`, so no external geocoder is involved. Returns
 * null when the feed fails — the caller then leaves `current_location` untouched (a stale city beats
 * wiping every driver's location over a transient stats hiccup) and the status sync itself still runs.
 */
async function fetchGpsByVehicle(
  fetcher: SamsaraGpsSnapshotFetcher,
): Promise<Map<string, VehicleGpsSnapshot> | null> {
  try {
    const raw = await fetcher();
    return parseVehicleGpsSnapshots(raw as Parameters<typeof parseVehicleGpsSnapshots>[0]);
  } catch (e) {
    console.warn(
      `[hosSync] vehicle GPS snapshot failed (driver locations left as-is): ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

/**
 * Pull the live HOS clocks (GET /fleet/hos/clocks) and stamp each matched driver's CURRENT duty status +
 * current truck onto the drivers row, for the Drivers page / Assignments board. Best-effort snapshot: only
 * drivers resolvable by samsara_driver_id are updated; the rest are left as-is. Reuses the same feed fuel
 * planning already reads, so there is no second historical pull for "who is on duty right now".
 */
export async function syncHosCurrentStatus(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { clocksFetcher?: SamsaraHosClocksFetcher; gpsFetcher?: SamsaraGpsSnapshotFetcher } = {},
): Promise<HosCurrentStatusResult> {
  const token = opts.clocksFetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const raw = await (opts.clocksFetcher ?? makeSamsaraHosClocksFetcher(env, token))();
  const statuses = parseHosClocks(raw.data);
  if (statuses.length === 0) return { drivers: 0, located: 0 };

  // Truck GPS snapshot → the driver's current city (via the driver's current vehicle). Null = feed down.
  const gpsByVehicle = await fetchGpsByVehicle(
    opts.gpsFetcher ?? makeSamsaraGpsSnapshotFetcher(env, token),
  );

  const { data: ds } = await admin
    .from("drivers")
    .select("id, samsara_driver_id")
    .eq("org_id", orgId)
    .not("samsara_driver_id", "is", null);
  const byS = new Map(
    ((ds ?? []) as { id: string; samsara_driver_id: string }[]).map((d) => [
      d.samsara_driver_id,
      d.id,
    ]),
  );

  const now = new Date().toISOString();
  let drivers = 0;
  let located = 0;
  for (const st of statuses) {
    const id = byS.get(st.driverId);
    if (!id) continue;
    const patch: {
      current_hos_status: string;
      current_hos_vehicle: string | null;
      current_hos_at: string;
      current_location?: string | null;
    } = {
      current_hos_status: st.status,
      current_hos_vehicle: st.vehicleName,
      current_hos_at: now,
    };
    // Location is written ONLY when the GPS snapshot succeeded: a driver on a truck with a fix gets its
    // city; a driver with no truck / a truck without a fix is honestly cleared. When the snapshot failed
    // the key is omitted entirely so the last known city survives a transient feed error.
    if (gpsByVehicle) {
      const city = st.vehicleId
        ? cityFromFormattedLocation(gpsByVehicle.get(st.vehicleId)?.location)
        : null;
      patch.current_location = city;
    }
    const { error } = await admin.from("drivers").update(patch).eq("id", id).eq("org_id", orgId);
    if (!error) {
      drivers++;
      if (patch.current_location) located++;
    }
  }
  return { drivers, located };
}
