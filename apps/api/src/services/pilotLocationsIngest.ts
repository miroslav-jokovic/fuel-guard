/**
 * Ingests the Pilot "Download All Locations" export (the whole family: Pilot / Flying J / ONE9 / dealer
 * networks) into the GLOBAL station registry with EXACT chain-published coordinates — the precision
 * upgrade over the email ingest's city-centroid geocodes (which the planner's corridor math depends on).
 *
 * Matching is by STORE NUMBER across the whole Pilot family (store # is unique family-wide — verified on
 * the real export), NOT by (brand, store#): the legacy email ingest filed every site under brand 'pilot',
 * so a Flying J row must UPDATE that existing station (fixing its brand + coords IN PLACE, preserving its
 * id and therefore every fuel_prices/fuel_plan_stops reference) rather than insert a duplicate.
 *
 * Safety posture: registry stations missing from a fresh export are REPORTED, never auto-closed (a
 * closure is safety-critical and needs a second signal); unknown sub-brand names are flagged, not guessed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePilotLocationsExport, PILOT_FAMILY_BRANDS, type Cell, type PilotLocationRow } from "@fuelguard/shared";

const SOURCE = "pilot_locations_export";

export interface LocationsIngestResult {
  ok: boolean;
  error?: string;
  totalRows: number;
  updated: number;
  inserted: number;
  /** Rows dropped by the parser for concrete defects (missing store #, bad coords). */
  skipped: number;
  /** Location names that matched no known family brand — extend the brand map, don't guess. */
  unknownBrandNames: string[];
  /** Registry stations (family brands) whose store # was absent from this export — review, never auto-close. */
  missingFromExport: number;
  /** Stations whose coordinates moved by a suspicious distance (> ~5 mi) — expected for centroid fixes. */
  movedFar: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Rough distance in miles (equirectangular — fine at audit granularity). */
function roughMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 69;
  const dLng = (bLng - aLng) * 69 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function stationPatch(row: PilotLocationRow, nowIso: string) {
  return {
    brand: row.brand,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    state: row.state,
    exit: row.exit,
    address: row.address,
    city: row.city,
    zip: row.zip,
    country: row.country,
    phone: row.phone,
    parking_spaces: row.parkingSpaces,
    fuel_lane_count: row.fuelLaneCount,
    shower_count: row.showerCount,
    amenities: row.amenities,
    has_diesel: row.hasDiesel,
    has_def: row.hasDef,
    coord_source: "exact_export",
    location_updated_at: nowIso,
    source: SOURCE,
    updated_at: nowIso,
  };
}

export async function ingestPilotLocations(admin: SupabaseClient, grid: Cell[][]): Promise<LocationsIngestResult> {
  const parsed = parsePilotLocationsExport(grid);
  const base: LocationsIngestResult = {
    ok: false, totalRows: parsed.rows.length, updated: 0, inserted: 0,
    skipped: parsed.skipped, unknownBrandNames: parsed.unknownBrandNames, missingFromExport: 0, movedFar: 0,
  };
  if (!parsed.headerFound) return { ...base, error: "Unrecognized file — expected the Pilot 'Download All Locations' CSV export." };
  if (parsed.rows.length === 0) return { ...base, error: "No location rows found in the export." };

  // Existing family stations, keyed by store # (family-wide — includes legacy rows filed under 'pilot').
  const existing = new Map<string, { id: string; lat: number; lng: number }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fuel_stations").select("id, store_number, lat, lng")
      .in("brand", PILOT_FAMILY_BRANDS)
      .range(from, from + PAGE - 1);
    if (error) return { ...base, error: `Registry read failed: ${error.message}` };
    for (const r of (data ?? []) as Array<{ id: string; store_number: string | null; lat: number | string; lng: number | string }>) {
      if (r.store_number != null) existing.set(String(r.store_number), { id: r.id, lat: Number(r.lat), lng: Number(r.lng) });
    }
    if (!data || data.length < PAGE) break;
  }

  const nowIso = new Date().toISOString();
  const seen = new Set<string>();
  let updated = 0, inserted = 0, movedFar = 0;

  // Updates in place (id-preserving). Row-by-row: each may target a different existing id, and an
  // upsert on (brand, store_number) could NOT change brand without colliding with the unique index.
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Record<string, unknown>[] = [];
  for (const row of parsed.rows) {
    seen.add(row.storeNumber);
    const prior = existing.get(row.storeNumber);
    if (prior) {
      if (roughMiles(prior.lat, prior.lng, row.lat, row.lng) > 5) movedFar++;
      updates.push({ id: prior.id, patch: stationPatch(row, nowIso) });
    } else {
      inserts.push({ store_number: row.storeNumber, status: "active", ...stationPatch(row, nowIso) });
    }
  }

  for (const u of updates) {
    const { error } = await admin.from("fuel_stations").update(u.patch).eq("id", u.id);
    if (error) return { ...base, error: `Station update failed (id ${u.id}): ${error.message}`, updated, inserted, movedFar };
    updated++;
  }
  for (const part of chunk(inserts, 500)) {
    const { error } = await admin.from("fuel_stations").insert(part);
    if (error) return { ...base, error: `Station insert failed: ${error.message}`, updated, inserted, movedFar };
    inserted += part.length;
  }

  const missingFromExport = [...existing.keys()].filter((sn) => !seen.has(sn)).length;
  return { ...base, ok: true, updated, inserted, movedFar, missingFromExport };
}
