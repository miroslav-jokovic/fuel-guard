import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsMovementInput, DriverTimeOffInput } from "@fuelguard/shared";
import { generateIngestToken, hashIngestToken } from "../lib/ingestToken.js";

/**
 * TMS ingest — receives the NEUTRAL rows the on-prem sync agent POSTs (after it reads McLeod LoadMaster's
 * `ws` API locally) and upserts them into tms_movements / driver_time_off. Idempotent on the TMS's own ids,
 * so an agent can re-send a window safely. Runs with the service-role client (RLS-bypassing); every row is
 * stamped with the resolved org so tenants stay isolated.
 */

export interface IngestResult {
  received: number;
  upserted: number;
  /** Match keys (unit numbers / driver ids) we couldn't resolve to a FuelGuard record — surfaced so the
   *  agent/operator can fix the mapping rather than silently dropping context. */
  unmatched: string[];
}

/**
 * Resolve the org (+ provider) that owns an ingest bearer token, or null if unknown / disabled. The token is
 * matched by HASH — the plaintext is never stored — and only against an ENABLED integration, so a disabled or
 * rotated token stops working immediately.
 */
export async function orgForIngestToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ orgId: string; provider: string } | null> {
  if (!token) return null;
  const { data } = await admin
    .from("org_integrations")
    .select("org_id, provider, enabled")
    .eq("ingest_token_hash", hashIngestToken(token))
    .eq("enabled", true)
    .maybeSingle();
  if (!data) return null;
  return { orgId: (data as { org_id: string }).org_id, provider: (data as { provider: string }).provider };
}

export interface TmsIntegrationStatus {
  enabled: boolean;
  hasToken: boolean;
  tokenPrefix: string | null;
  lastSyncedAt: string | null;
}

/** Non-secret status for the settings UI (never returns the token or its hash). */
export async function getTmsIntegrationStatus(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
): Promise<TmsIntegrationStatus> {
  const { data } = await admin
    .from("org_integrations")
    .select("enabled, ingest_token_hash, ingest_token_prefix, last_synced_at")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  const row = data as { enabled?: boolean; ingest_token_hash?: string | null; ingest_token_prefix?: string | null; last_synced_at?: string | null } | null;
  return {
    enabled: row?.enabled ?? false,
    hasToken: !!row?.ingest_token_hash,
    tokenPrefix: row?.ingest_token_prefix ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
  };
}

/**
 * Enable the integration and issue a fresh ingest token (also the ROTATE path — re-calling invalidates the
 * previous token, since only the newest hash is stored). Returns the one-time plaintext for the admin to copy
 * into the agent; only the hash + prefix are persisted.
 */
export async function enableTmsIntegration(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
): Promise<{ token: string; prefix: string }> {
  const { token, hash, prefix } = generateIngestToken();
  const { error } = await admin.from("org_integrations").upsert(
    {
      org_id: orgId,
      provider,
      enabled: true,
      ingest_token_hash: hash,
      ingest_token_prefix: prefix,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider" },
  );
  if (error) throw new Error(error.message);
  return { token, prefix };
}

/** Disable the integration and CLEAR the token hash so no agent can post until it's re-enabled. */
export async function disableTmsIntegration(admin: SupabaseClient, orgId: string, provider: string): Promise<void> {
  const { error } = await admin
    .from("org_integrations")
    .update({ enabled: false, ingest_token_hash: null, ingest_token_prefix: null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", provider);
  if (error) throw new Error(error.message);
}

/** Stamp a successful sync so the UI can show freshness. Best-effort — never fails the ingest. */
export async function touchLastSynced(admin: SupabaseClient, orgId: string, provider: string): Promise<void> {
  await admin
    .from("org_integrations")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("provider", provider);
}

async function unitMap(
  admin: SupabaseClient,
  table: "vehicles" | "trailers",
  orgId: string,
): Promise<Map<string, string>> {
  const { data } = await admin.from(table).select("id, unit_number").eq("org_id", orgId);
  const m = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; unit_number: string | null }[]) {
    if (r.unit_number) m.set(r.unit_number, r.id);
  }
  return m;
}

/** Upsert normalized TMS movements for an org (idempotent on org + provider + external_id). */
export async function ingestMovements(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  movements: TmsMovementInput[],
): Promise<IngestResult> {
  const vehicles = await unitMap(admin, "vehicles", orgId);
  const trailers = await unitMap(admin, "trailers", orgId);
  const unmatched = new Set<string>();
  const now = new Date().toISOString();
  const rows = movements.map((m) => {
    const vehicle_id = m.vehicle_unit ? (vehicles.get(m.vehicle_unit) ?? null) : null;
    if (m.vehicle_unit && !vehicle_id) unmatched.add(m.vehicle_unit);
    return {
      org_id: orgId,
      provider,
      external_id: m.external_id,
      vehicle_id,
      trailer_id: m.trailer_unit ? (trailers.get(m.trailer_unit) ?? null) : null,
      started_at: m.started_at ?? null,
      ended_at: m.ended_at ?? null,
      temperature_controlled: m.temperature_controlled ?? false,
      setpoint_f: m.setpoint_f ?? null,
      commodity: m.commodity ?? null,
      raw: m.raw ?? {},
      synced_at: now,
    };
  });
  if (rows.length) {
    const { error } = await admin.from("tms_movements").upsert(rows, { onConflict: "org_id,provider,external_id" });
    if (error) throw new Error(error.message);
  }
  return { received: movements.length, upserted: rows.length, unmatched: [...unmatched] };
}

/** Upsert driver home-time / time-off windows for an org. Rows with an external_id are idempotent. */
export async function ingestDriverTimeOff(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  windows: DriverTimeOffInput[],
): Promise<IngestResult> {
  const { data: drv } = await admin.from("drivers").select("id, employee_id, samsara_driver_id").eq("org_id", orgId);
  const byEmp = new Map<string, string>();
  const bySam = new Map<string, string>();
  for (const d of (drv ?? []) as { id: string; employee_id: string | null; samsara_driver_id: string | null }[]) {
    if (d.employee_id) byEmp.set(d.employee_id, d.id);
    if (d.samsara_driver_id) bySam.set(d.samsara_driver_id, d.id);
  }
  const unmatched = new Set<string>();
  const now = new Date().toISOString();
  const rows = windows.map((w) => {
    const driver_id =
      (w.driver_employee_id ? byEmp.get(w.driver_employee_id) : undefined) ??
      (w.driver_samsara_id ? bySam.get(w.driver_samsara_id) : undefined) ??
      null;
    const key = w.driver_employee_id ?? w.driver_samsara_id;
    if (key && !driver_id) unmatched.add(key);
    return {
      org_id: orgId,
      provider,
      external_id: w.external_id ?? null,
      driver_id,
      start_at: w.start_at,
      end_at: w.end_at ?? null,
      kind: w.kind ?? "home_time",
      raw: w.raw ?? {},
      synced_at: now,
    };
  });
  // external_id is the idempotency key when present; windows without one are appended best-effort.
  const withExt = rows.filter((r) => r.external_id != null);
  const withoutExt = rows.filter((r) => r.external_id == null);
  if (withExt.length) {
    const { error } = await admin.from("driver_time_off").upsert(withExt, { onConflict: "org_id,provider,external_id" });
    if (error) throw new Error(error.message);
  }
  if (withoutExt.length) {
    const { error } = await admin.from("driver_time_off").insert(withoutExt);
    if (error) throw new Error(error.message);
  }
  return { received: windows.length, upserted: rows.length, unmatched: [...unmatched] };
}
