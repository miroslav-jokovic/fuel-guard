import type { SupabaseClient } from "@supabase/supabase-js";
import { parseStationIdentity, learnStationCoord } from "@fuelguard/shared";

export interface StationGeocodeLearnResult {
  stations: number; // distinct stations examined
  learned: number; // stations upgraded to a learned 'site' coordinate
}

const PAGE = 1000;

interface FillLoc {
  location_text: string | null;
  city: string | null;
  state: string | null;
  samsara_observed_lat: number | string | null;
  samsara_observed_lng: number | string | null;
}

/**
 * Upgrade city-level stations to precise 'site' coordinates LEARNED from our own telematics. Trucks stopping
 * to fuel at a station cluster at the same pump lot, so the median of their observed stop positions is the
 * station's true coordinate — better for confirmation than a city-centroid geocode, and free. Writes an
 * ORG-SCOPED station_geocode_learned row for stations that aren't already 'site' (audit A3.1: this coordinate
 * is derived from THIS org's private telematics, so it must not land in the shared, cross-tenant geocode_cache).
 * After this, a re-check confirms fills there (truck GPS within the confirm radius of the learned pump
 * coordinate). Idempotent; safe to re-run.
 */
export async function learnStationGeocodes(admin: SupabaseClient, orgId: string): Promise<StationGeocodeLearnResult> {
  // 1) Gather each fill's station identity + the truck's observed stop position.
  const byStation = new Map<string, { positions: { lat: number; lng: number }[]; name: string | null; city: string | null; state: string | null }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("location_text, city, state, samsara_observed_lat, samsara_observed_lng")
      .eq("org_id", orgId)
      .not("samsara_observed_lat", "is", null)
      .not("samsara_observed_lng", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as FillLoc[];
    for (const r of batch) {
      const id = parseStationIdentity(r.location_text, r.city, r.state);
      if (!id.siteKey) continue;
      const cur = byStation.get(id.siteKey) ?? { positions: [], name: r.location_text, city: r.city, state: r.state };
      cur.positions.push({ lat: Number(r.samsara_observed_lat), lng: Number(r.samsara_observed_lng) });
      byStation.set(id.siteKey, cur);
    }
    if (batch.length < PAGE) break;
  }
  if (byStation.size === 0) return { stations: 0, learned: 0 };

  // 2) Skip stations we already have a 'site' coordinate for: either the shared provider geocode resolved this
  //    station precisely (geocode_cache precision='site'), or this org already learned it
  //    (station_geocode_learned). We only UPGRADE city-level stations.
  const keys = [...byStation.keys()];
  const alreadySite = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const { data: provider } = await admin.from("geocode_cache").select("query, precision").in("query", slice);
    for (const r of (provider ?? []) as { query: string; precision: string | null }[]) {
      if (r.precision === "site") alreadySite.add(r.query);
    }
    const { data: mine } = await admin.from("station_geocode_learned").select("query").eq("org_id", orgId).in("query", slice);
    for (const r of (mine ?? []) as { query: string }[]) alreadySite.add(r.query);
  }

  // 3) Cluster each remaining station's stop positions → learned 'site' coordinate, stored ORG-SCOPED.
  let learned = 0;
  const now = new Date().toISOString();
  for (const [key, s] of byStation) {
    if (alreadySite.has(key)) continue;
    const coord = learnStationCoord(s.positions);
    if (!coord) continue;
    const { error } = await admin.from("station_geocode_learned").upsert(
      { org_id: orgId, query: key, lat: coord.lat, lng: coord.lng, samples: coord.samples, updated_at: now },
      { onConflict: "org_id,query" },
    );
    if (error) throw new Error(error.message);
    learned++;
  }
  return { stations: byStation.size, learned };
}
