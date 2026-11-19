/**
 * What Samsara saw at each placed plaza when each toll was printed, a time budget a tick
 * (TOLLS-PER-TRUCK-PLAN TL8a, D-TL14, D-TL21, Q-TL10).
 *
 * ── EVERY TOLL AT A PLACED PLAZA, OLDEST FIRST ─────────────────────────────────────────────────
 * Owner 2026-11-18 (Q-TL10): the evidence is fetched and stored as soon as a statement is read, and the
 * April backfill runs at once, because April sits at the edge of Samsara's history. So the oldest
 * windows go first: a later retention cut takes the oldest day first too. A toll whose plaza is not
 * placed yet waits; it is observed the tick its plaza is placed.
 *
 * ── ONE FETCH PER WINDOW, FOR THE WHOLE FLEET ──────────────────────────────────────────────────
 * Checkpoints within 15 minutes of each other share one `stats/history?types=gps` window
 * (`planWindows`), asked for every vehicle Samsara lists — sold ones too — 200 ids a request, with a
 * fix interval of margin either side so a truck can be read BETWEEN two fixes at the window's edge.
 * Trailer gateways are asked only for a window holding a toll billed by plate, the only kind a trailer
 * can have paid (D-TL16). A window Samsara did not finish sending is not stored: the tick stops and the
 * next one asks again. Measured 2026-11-19: a window is 1–4 MB of JSON, so the budget is time, not a
 * count.
 *
 * A printed time that is two instants or none in the plaza's zone is stored as `clock_ambiguous` or
 * `clock_skipped` without a fetch.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunks, tollGps } from "@silvicom/shared";
import type { AssetGpsFetcher } from "../../samsara/index.js";
import { currentPlazas, insertObservations, observedKey, observedKeys, tollLines, type ObservationRow, type PlazaRow } from "./store.js";

/** How long one tick may spend fetching windows. */
export const OBSERVE_BUDGET_MS = 4 * 60_000;
const IDS_PER_REQUEST = 200;

export interface ObservationPassDeps {
  fetchVehicles: AssetGpsFetcher;
  fetchTrailers: AssetGpsFetcher;
  listVehicles: () => Promise<unknown[]>;
  listTrailers: () => Promise<unknown[]>;
  nowMs: () => number;
}

interface DueCheckpoint extends tollGps.Due {
  lineId: string;
  role: tollGps.TollCheckpointRole;
  plaza: PlazaRow;
  byPlate: boolean;
}

export interface ObservationTally {
  observed: number;
  clock: number;
  windows: number;
  /** Checkpoints due and not reached this tick. */
  waiting: number;
}

/** Split what is due into checkpoints to fetch and clock outcomes to record as they are. */
export function dueCheckpoints(
  lines: readonly tollGps.TollLineForGps[],
  plazas: ReadonlyMap<string, PlazaRow>,
  done: ReadonlySet<string>,
  orgId: string,
): { due: DueCheckpoint[]; clock: ObservationRow[] } {
  const due: DueCheckpoint[] = [];
  const clock: ObservationRow[] = [];
  for (const line of lines) {
    for (const cp of tollGps.checkpointsOf(line)) {
      const p = plazas.get(cp.plazaKey);
      if (!p || p.outcome !== "placed" || done.has(observedKey(line.id, cp.role, p.id))) continue;
      const at = tollGps.instantsOf(cp.local, p.time_zone!);
      if (at.length === 1) {
        due.push({ ...tollGps.plazaWindow(at[0]!, { offsetS: p.offset_s!, offsetSpreadS: p.offset_spread_s! }), lineId: line.id, role: cp.role, plaza: p, byPlate: !line.tagNumber });
      } else {
        clock.push({ org_id: orgId, line_id: line.id, role: cp.role, plaza_id: p.id, outcome: at.length === 0 ? "clock_skipped" : "clock_ambiguous", at: null, half_window_s: null, nearby: [], reporting: [] });
      }
    }
  }
  return { due, clock };
}

async function tracksOf(fetch: AssetGpsFetcher, ids: readonly string[], kind: tollGps.AssetKind, startMs: number, endMs: number): Promise<tollGps.AssetTrack[]> {
  const out: tollGps.AssetTrack[] = [];
  for (const part of chunks(ids, IDS_PER_REQUEST)) {
    const res = await fetch(part, new Date(startMs).toISOString(), new Date(endMs).toISOString());
    if (!res.complete) throw new Error(`Samsara GPS for ${part.length} ${kind}s came back incomplete`);
    for (const d of res.data) out.push({ samsaraId: String(d.id), kind, fixes: tollGps.fixesOfGps(d) });
  }
  return out;
}

const idsOf = (assets: unknown[]) => assets.map((a) => String((a as { id?: unknown }).id ?? "")).filter((id) => id !== "");

/** Observe what is due, oldest window first, until the budget is spent. */
export async function observeTolls(admin: SupabaseClient, orgId: string, deps: ObservationPassDeps, budgetMs = OBSERVE_BUDGET_MS): Promise<ObservationTally> {
  const started = deps.nowMs();
  const [lines, plazas, done] = await Promise.all([tollLines(admin, orgId), currentPlazas(admin, orgId), observedKeys(admin, orgId)]);
  const { due, clock } = dueCheckpoints(lines, plazas, done, orgId);
  for (const part of chunks(clock, 500)) await insertObservations(admin, orgId, part);
  const tally: ObservationTally = { observed: 0, clock: clock.length, windows: 0, waiting: due.length };
  if (due.length === 0) return tally;

  const vehicleIds = idsOf(await deps.listVehicles());
  let trailerIds: string[] | null = null;
  for (const w of tollGps.planWindows(due)) {
    if (deps.nowMs() - started >= budgetMs) break;
    const from = w.startMs - tollGps.MAX_GAP_MS;
    const until = w.endMs + tollGps.MAX_GAP_MS;
    const vehicles = await tracksOf(deps.fetchVehicles, vehicleIds, "vehicle", from, until);
    let trailers: tollGps.AssetTrack[] = [];
    if (w.members.some((m) => m.byPlate)) {
      trailerIds ??= idsOf(await deps.listTrailers());
      trailers = await tracksOf(deps.fetchTrailers, trailerIds, "trailer", from, until);
    }
    const rows: ObservationRow[] = w.members.map((m) => {
      const o = tollGps.observe({ lat: m.plaza.lat!, lon: m.plaza.lon! }, m, m.byPlate ? [...vehicles, ...trailers] : vehicles);
      return { org_id: orgId, line_id: m.lineId, role: m.role, plaza_id: m.plaza.id, outcome: "observed", at: new Date(m.atMs).toISOString(), half_window_s: Math.round(m.halfMs / 1000), nearby: o.nearby, reporting: o.reporting };
    });
    await insertObservations(admin, orgId, rows);
    tally.observed += rows.length;
    tally.waiting -= rows.length;
    tally.windows += 1;
  }
  return tally;
}
