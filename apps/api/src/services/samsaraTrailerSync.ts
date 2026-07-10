import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSamsaraTrailers, parseTrailerAssignments } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import {
  makeSamsaraTrailerLister,
  makeSamsaraTrailerAssignmentFetcher,
  type SamsaraTrailerLister,
  type SamsaraTrailerAssignmentFetcher,
} from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { inferReeferPairings } from "./reeferPairing.js";

export interface TrailerSyncResult {
  total: number;
  created: number;
  updated: number;
  paired: number; // trailers whose tractor pairing was set from Samsara
}

interface ExistingTrailer {
  id: string;
  samsara_asset_id: string | null;
  unit_number: string;
}

/**
 * Pull the org's trailers from Samsara into `trailers` and upsert by samsara_asset_id → unit number.
 * On a match we refresh identity + stamp samsara_asset_id, but NEVER clobber user-owned fields
 * (unit_number, reefer_tank_capacity_gal). New trailers default to a 50-gal reefer tank. Then resolve
 * each trailer's current tractor from Samsara trailer assignments (best-effort).
 */
export async function syncTrailersFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  listerOverride?: SamsaraTrailerLister,
  assignmentOverride?: SamsaraTrailerAssignmentFetcher,
): Promise<TrailerSyncResult> {
  const token = listerOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const lister = listerOverride ?? makeSamsaraTrailerLister(env, token);
  const trailers = parseSamsaraTrailers({ data: (await lister()) as { id?: string }[] });

  const { data: existingData } = await admin
    .from("trailers")
    .select("id, samsara_asset_id, unit_number")
    .eq("org_id", orgId);
  const existing = (existingData ?? []) as ExistingTrailer[];
  const bySamsara = new Map(existing.filter((r) => r.samsara_asset_id).map((r) => [r.samsara_asset_id!, r]));
  const byUnit = new Map(existing.map((r) => [r.unit_number, r]));

  const result: TrailerSyncResult = { total: trailers.length, created: 0, updated: 0, paired: 0 };

  for (const t of trailers) {
    const identity = { make: t.make, model: t.model, year: t.year, plate: t.licensePlate };
    const match = bySamsara.get(t.samsaraId) ?? byUnit.get(t.name);
    if (match) {
      await admin
        .from("trailers")
        .update({ ...identity, samsara_asset_id: t.samsaraId })
        .eq("id", match.id)
        .eq("org_id", orgId);
      result.updated++;
      continue;
    }
    const { error } = await admin.from("trailers").insert({
      org_id: orgId,
      unit_number: t.name,
      ...identity,
      samsara_asset_id: t.samsaraId,
      reefer_tank_capacity_gal: 50,
      status: "active",
    });
    if (error) {
      if (error.code === "23505") {
        await admin.from("trailers").update({ ...identity, samsara_asset_id: t.samsaraId }).eq("org_id", orgId).eq("unit_number", t.name);
        result.updated++;
        continue;
      }
      throw new Error(error.message);
    }
    result.created++;
  }

  // ── Pair each trailer to its current tractor from Samsara assignments (best-effort) ──────────
  try {
    const fetcher = assignmentOverride ?? makeSamsaraTrailerAssignmentFetcher(env, token);
    const links = parseTrailerAssignments((await fetcher()) as Parameters<typeof parseTrailerAssignments>[0]);
    if (links.length) {
      const [{ data: tRows }, { data: vRows }] = await Promise.all([
        admin.from("trailers").select("id, samsara_asset_id, pairing_source").eq("org_id", orgId).not("samsara_asset_id", "is", null),
        admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId).not("samsara_vehicle_id", "is", null),
      ]);
      const trById = new Map((tRows ?? []).map((r) => [r.samsara_asset_id as string, { id: r.id as string, source: (r.pairing_source as string | null) ?? null }]));
      const vehById = new Map((vRows ?? []).map((r) => [r.samsara_vehicle_id as string, r.id as string]));
      for (const link of links) {
        const tr = trById.get(link.trailerSamsaraId);
        const vehId = vehById.get(link.vehicleSamsaraId);
        // A manual pairing is authoritative — never overwrite it with the Samsara-assignment feed.
        if (tr && tr.source !== "manual" && vehId) {
          await admin.from("trailers").update({ assigned_vehicle_id: vehId, pairing_source: "samsara", pairing_confidence: null }).eq("id", tr.id).eq("org_id", orgId);
          result.paired++;
        }
      }
    }
  } catch {
    /* assignments are best-effort */
  }

  // Reefer↔tractor pairing by GPS CO-LOCATION — the reliable path when drivers don't select the trailer in
  // the app but the reefer has an Asset Gateway. Best-effort: never breaks the identity sync above. Skips
  // trailers already pinned manually or by the Samsara assignment feed handled above.
  try {
    const inferred = await inferReeferPairings(admin, env, orgId);
    result.paired += inferred.paired;
    console.log(`[trailer-sync] reefer co-location: ${inferred.candidates} candidates, ${inferred.paired} paired`);
  } catch (e) {
    // Best-effort (never breaks the identity sync), but LOG it — a 401 here almost always means the token is
    // missing the "Read Trailer Statistics" scope, which otherwise fails silently.
    console.error("[trailer-sync] reefer co-location inference failed:", e instanceof Error ? e.message : e);
  }

  return result;
}
