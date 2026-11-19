/**
 * Learning where each toll plaza stands, a batch of plazas a tick (TOLLS-PER-TRUCK-PLAN TL8a, D-TL14,
 * D-TL21). The rules are `@silvicom/shared` tollGps.learnPlaza; this file finds the known tolls,
 * fetches their trucks' tracks and keeps the attempt.
 *
 * ── A KNOWN TOLL IS ONE THE TAG HISTORY ALREADY GIVES TO ONE TRUCK ─────────────────────────────
 * The printed time is read on the org's clock only to ask the history (`attributeToll`, whose three-
 * hour swap margin covers every US zone, D-TL4); a toll near a swap is not known. Plates are not used
 * to learn: a plate has no dated history until TL8b (D-TL16), and `vehicles.plate` is today's only. So
 * ExpressToll's own plazas, billed by plate on 98% of lines, wait for TL8b.
 *
 * ── WHICH PLAZAS, IN WHAT ORDER ────────────────────────────────────────────────────────────────
 * A plaza is due when it has no attempt at this engine version, or its last attempt was not placed and
 * it now has more known tolls than then. Busiest first: the money is there. Each attempt costs one
 * Samsara call per sample (eight at most), on the backfill lane.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { attributeToll, tollGps, tollTagKey, wallClockToUtc, type TagAssignment } from "@silvicom/shared";
import type { AssetGpsFetcher } from "../../samsara/index.js";
import { currentPlazas, insertPlaza, orgTimeZone, tagHistory, tollLines, type PlazaRow } from "./store.js";

export const PLAZAS_PER_TICK = 20;

export interface PlazaCandidates {
  provider: tollGps.TollCheckpoint["provider"];
  role: tollGps.TollCheckpointRole;
  tolls: number;
  known: tollGps.KnownToll[];
}

/** Every plaza the lines name, with its toll count and the tolls whose truck the tag history knows. */
export function knownByPlaza(
  lines: readonly tollGps.TollLineForGps[],
  historyOf: ReadonlyMap<string, TagAssignment[]>,
  samsaraOf: ReadonlyMap<string, string>,
  orgZone: string,
): Map<string, PlazaCandidates> {
  const out = new Map<string, PlazaCandidates>();
  for (const line of lines) {
    const tagKey = line.tagNumber ? tollTagKey(line.provider, line.tagNumber) : null;
    const history = tagKey ? historyOf.get(tagKey) : undefined;
    for (const cp of tollGps.checkpointsOf(line)) {
      const entry = out.get(cp.plazaKey) ?? { provider: cp.provider, role: cp.role, tolls: 0, known: [] };
      entry.tolls += 1;
      out.set(cp.plazaKey, entry);
      if (!tagKey || !history) continue;
      const a = attributeToll(history, wallClockToUtc(tollGps.parseLocal(cp.local)!, orgZone));
      const samsaraVehicleId = a.kind === "matched" ? samsaraOf.get(a.vehicleId) : undefined;
      if (a.kind === "matched" && samsaraVehicleId) {
        entry.known.push({ lineId: line.id, role: cp.role, local: cp.local, tagKey, vehicleId: a.vehicleId, samsaraVehicleId });
      }
    }
  }
  return out;
}

/** The plazas to try now, busiest first. */
export function duePlazas(candidates: ReadonlyMap<string, PlazaCandidates>, current: ReadonlyMap<string, PlazaRow>): string[] {
  return [...candidates.entries()]
    .filter(([key, c]) => {
      if (c.known.length < tollGps.PLAZA_MIN_SAMPLES) return false;
      const cur = current.get(key);
      return !cur || (cur.outcome === "not_placed" && c.known.length > cur.known_count);
    })
    .sort((a, b) => b[1].tolls - a[1].tolls || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

export interface PlazaPassDeps {
  fetchGps: AssetGpsFetcher;
  zoneAt: (lat: number, lon: number) => string | null;
}

/** One batch: learn up to `limit` due plazas and keep each attempt. Returns placed / not placed counts. */
export async function learnPlazas(admin: SupabaseClient, orgId: string, deps: PlazaPassDeps, limit = PLAZAS_PER_TICK): Promise<{ placed: number; not_placed: number }> {
  const [lines, { historyOf, samsaraOf }, zone, current] = await Promise.all([
    tollLines(admin, orgId),
    tagHistory(admin, orgId),
    orgTimeZone(admin, orgId),
    currentPlazas(admin, orgId),
  ]);
  const candidates = knownByPlaza(lines, historyOf, samsaraOf, zone);
  const tally = { placed: 0, not_placed: 0 };
  for (const key of duePlazas(candidates, current).slice(0, limit)) {
    const c = candidates.get(key)!;
    const tracks: tollGps.SampleTrack[] = [];
    for (const sample of tollGps.pickSamples(c.known)) {
      const span = tollGps.sampleFetchSpan(sample.local);
      if (!span) continue;
      const res = await deps.fetchGps([sample.samsaraVehicleId], new Date(span.startMs).toISOString(), new Date(span.endMs).toISOString());
      // A track Samsara did not finish sending is not a track: the plaza waits for the next tick.
      if (!res.complete) throw new Error(`Samsara GPS for vehicle ${sample.samsaraVehicleId} came back incomplete`);
      tracks.push({ sample, fixes: tollGps.fixesOfGps(res.data.find((d) => String(d.id) === sample.samsaraVehicleId)) });
    }
    const r = tollGps.learnPlaza(tracks, deps.zoneAt);
    const placed = r.outcome === "placed";
    await insertPlaza(admin, {
      org_id: orgId,
      provider: c.provider,
      role: c.role,
      plaza_key: key,
      engine_version: tollGps.PLAZA_ENGINE_VERSION,
      outcome: r.outcome,
      reason: placed ? null : r.reason,
      lat: placed ? r.lat : null,
      lon: placed ? r.lon : null,
      spread_m: placed ? r.spreadM : null,
      time_zone: placed ? r.zone : null,
      offset_s: placed ? r.offsetS : null,
      offset_spread_s: placed ? r.offsetSpreadS : null,
      sample_count: placed ? r.sampleCount : null,
      day_count: placed ? r.dayCount : null,
      known_count: c.known.length,
      samples: r.samples,
      readings: r.readings,
    });
    tally[r.outcome] += 1;
  }
  return tally;
}
