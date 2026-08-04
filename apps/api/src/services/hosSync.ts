import type { SupabaseClient } from "@supabase/supabase-js";
import { parseHosLogs, parseHosClocks, type HosSegment } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import {
  makeSamsaraHosLogsFetcher,
  makeSamsaraHosClocksFetcher,
  type SamsaraHosLogsFetcher,
  type SamsaraHosClocksFetcher,
} from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface HosSyncResult {
  fetched: number; // duty-status segments parsed from the window
  upserted: number;
}

const UPSERT_CHUNK = 500;

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

/**
 * Pull Samsara HOS duty-status logs over the trailing window, normalize to contiguous duty-status segments,
 * resolve each to our driver (via samsara_driver_id), and upsert into hos_duty_segments. Idempotent on
 * (org_id, samsara_driver_id, started_at) — a re-sync closes previously-open segments (refreshes ended_at)
 * and links a driver_id that matched late. Segments are stored per DRIVER; the idle overlay joins them to a
 * truck via the driver↔vehicle assignment at the time.
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

  const days = opts.sinceDays ?? 30;
  const endIso = opts.endIso ?? new Date().toISOString();
  const startIso = opts.startIso ?? new Date(Date.parse(endIso) - days * 86_400_000).toISOString();

  const fetchHos = opts.hosFetcher ?? makeSamsaraHosLogsFetcher(env, token);
  const raw = await fetchHos(startIso, endIso);
  const segments = parseHosLogs(raw.data, { windowEndMs: Date.parse(endIso) });
  warnOnShapeMismatch(raw.data, segments.length);
  if (segments.length === 0) return { fetched: 0, upserted: 0 };

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

  const now = new Date().toISOString();
  const rows = segments.map((s: HosSegment) => ({
    org_id: orgId,
    driver_id: drvBySamsara.get(s.driverId) ?? null,
    samsara_driver_id: s.driverId,
    status: s.status,
    started_at: new Date(s.startMs).toISOString(),
    ended_at: s.endMs != null ? new Date(s.endMs).toISOString() : null,
    updated_at: now,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin
      .from("hos_duty_segments")
      .upsert(chunk, { onConflict: "org_id,samsara_driver_id,started_at" });
    if (error) throw new Error(error.message);
    upserted += chunk.length;
  }
  return { fetched: segments.length, upserted };
}

export interface HosCurrentStatusResult {
  drivers: number; // driver rows whose live HOS status was refreshed
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
  opts: { clocksFetcher?: SamsaraHosClocksFetcher } = {},
): Promise<HosCurrentStatusResult> {
  const token = opts.clocksFetcher ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const raw = await (opts.clocksFetcher ?? makeSamsaraHosClocksFetcher(env, token))();
  const statuses = parseHosClocks(raw.data);
  if (statuses.length === 0) return { drivers: 0 };

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
  for (const st of statuses) {
    const id = byS.get(st.driverId);
    if (!id) continue;
    const { error } = await admin
      .from("drivers")
      .update({
        current_hos_status: st.status,
        current_hos_vehicle: st.vehicleName,
        current_hos_at: now,
      })
      .eq("id", id)
      .eq("org_id", orgId);
    if (!error) drivers++;
  }
  return { drivers };
}
