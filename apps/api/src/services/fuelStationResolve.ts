/**
 * Point recorded fills at the station they were bought from.
 *
 * `fuel_transactions.station_id` shipped as a column in migration 0243 and stayed 0% populated, so
 * every brand question — how much at ONE9, how much off-network, what did California cost — could only
 * be answered from an uploaded vendor statement covering five weeks. The matching rules and their
 * evidence live in `@fuelguard/shared`'s `stationMatch`; this service is the I/O around them.
 *
 * ── WHY THIS RUNS FOREVER AND NOT ONCE ───────────────────────────────────────────────────────────
 * A backfill alone would have been stale within a day: the EFS feed writes new fills continuously and
 * none of them carry a station. So the same resolver runs nightly over whatever is still unresolved,
 * and brand analysis keeps working instead of decaying from the moment it shipped. `onlyUnresolved`
 * exists so a change to the matcher can re-resolve everything rather than only the leftovers.
 *
 * ── WHY UPDATE AND NOT UPSERT ────────────────────────────────────────────────────────────────────
 * This owns ONE column on rows that already exist. Expressing that as an upsert keyed on the primary
 * key is the defect `lint:upserts` exists to catch: Postgres checks NOT NULL on the proposed tuple
 * before conflict arbitration, so a partial payload fails on precisely the rows it means to update.
 * Fills are grouped by the station they resolved to and written as one UPDATE … WHERE id IN (…) per
 * station, which is a few hundred statements for tens of thousands of fills.
 *
 * ── ORG SCOPING ──────────────────────────────────────────────────────────────────────────────────
 * `fuel_stations` is GLOBAL reference data and is read unscoped; everything touching
 * `fuel_transactions` filters `org_id` explicitly, including the writes. The service role bypasses
 * RLS, so that filter is the tenant boundary — asserted by `expectOrgScoped` in the tests.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStationIndex, matchFillStation, type StationMatchReason, type StationRef } from "@fuelguard/shared";
import { eachPage } from "../lib/paging.js";

const UPDATE_CHUNK = 500;

export interface StationResolveResult {
  orgId: string;
  scanned: number;
  resolved: number;
  /** Every outcome, including the ones that produced no station — a gap you cannot count is a gap you
   *  cannot close, and 3.6% of production fills legitimately do not resolve. */
  byReason: Record<StationMatchReason, number>;
  /** Store keys the registry has no row for, worst first — the list that makes the registry better. */
  topUnmatched: Array<{ key: string; fills: number }>;
  updates: number;
}

const EMPTY_REASONS = (): Record<StationMatchReason, number> => ({
  family: 0, brand: 0, no_brand: 0, no_store: 0, no_state: 0, unmatched: 0, ambiguous: 0,
});

interface RawFill {
  id: string;
  location_text: string | null;
  state: string | null;
}

/** The global station registry, projected to what the matcher needs. Not org-scoped: it is shared data. */
async function readStations(admin: SupabaseClient): Promise<StationRef[]> {
  const out: StationRef[] = [];
  await eachPage<{ id: string; brand: string; store_number: string | null; state: string | null }>(
    (a, b) => admin.from("fuel_stations").select("id, brand, store_number, state").range(a, b),
    (rows) => {
      for (const s of rows) {
        if (!s.store_number) continue;
        out.push({ id: s.id, brand: s.brand, storeNumber: s.store_number, state: s.state });
      }
    },
  );
  return out;
}

export async function resolveFuelTransactionStations(
  admin: SupabaseClient,
  orgId: string,
  opts: { onlyUnresolved?: boolean } = {},
): Promise<StationResolveResult> {
  const onlyUnresolved = opts.onlyUnresolved ?? true;
  const index = buildStationIndex(await readStations(admin));

  const byReason = EMPTY_REASONS();
  const unmatchedKeys = new Map<string, number>();
  const byStation = new Map<string, string[]>();
  let scanned = 0;

  await eachPage<RawFill>(
    (a, b) => {
      const q = admin
        .from("fuel_transactions")
        .select("id, location_text, state")
        .eq("org_id", orgId)
        .order("id", { ascending: true })
        .range(a, b);
      return onlyUnresolved ? q.is("station_id", null) : q;
    },
    (rows) => {
      for (const f of rows) {
        scanned++;
        const m = matchFillStation(index, f.location_text, f.state);
        byReason[m.reason]++;
        if (m.stationId) {
          const list = byStation.get(m.stationId);
          if (list) list.push(f.id);
          else byStation.set(m.stationId, [f.id]);
        } else if (m.key && (m.reason === "unmatched" || m.reason === "ambiguous")) {
          unmatchedKeys.set(m.key, (unmatchedKeys.get(m.key) ?? 0) + 1);
        }
      }
    },
  );

  const updates = await writeStations(admin, orgId, byStation);

  return {
    orgId,
    scanned,
    resolved: byReason.family + byReason.brand,
    byReason,
    topUnmatched: [...unmatchedKeys.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, fills]) => ({ key, fills })),
    updates,
  };
}

/** One UPDATE per station per chunk. Never an upsert — see the header. */
async function writeStations(
  admin: SupabaseClient,
  orgId: string,
  byStation: Map<string, string[]>,
): Promise<number> {
  let updates = 0;
  for (const [stationId, ids] of byStation) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const { error } = await admin
        .from("fuel_transactions")
        .update({ station_id: stationId })
        .eq("org_id", orgId)
        .in("id", ids.slice(i, i + UPDATE_CHUNK));
      if (error) throw new Error(`station resolve write failed: ${error.message}`);
      updates++;
    }
  }
  return updates;
}
