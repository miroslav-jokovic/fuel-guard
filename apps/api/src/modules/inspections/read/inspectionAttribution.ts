import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AttributionBasis,
  AttributionConfidence,
  AttributionDriverRefDto,
  AttributionLocationCheck,
  AttributionOutcome,
  AttributionSource,
  AttributionZoneMethod,
  RoadsideAttributionDto,
} from "@silvicom/shared";
import { labelOf, memberLabels } from "../../../lib/memberLabels.js";
import type { DbError } from "./inspectionsList.js";

/**
 * Who was driving at one roadside inspection, for its page (INSPECTION-CHALLENGE-PLAN §6, D-IC7): the
 * engine's latest reading of Samsara (`attribution/attribute.ts`) and a person's latest decision over it
 * (`attribution/decide.ts`), both from the append-only `inspection_attributions` (0473).
 *
 * ── THE ROSTER IS RESOLVED HERE, BY ID, NEVER BY NAME ──────────────────────────────────────────
 * The engine stores Samsara's driver id and name — the evidence — and no roster id (0473: a `drivers`
 * FK would put an append-only table in `merge_driver`'s move list). Our driver is the roster row with
 * that Samsara id, read now. Measured 2026-10-14 on production: 916 of the 1,117 Samsara drivers in
 * our HOS history have no roster row, so an older inspection usually reads "not on our roster" — and
 * says so, rather than borrowing a roster row with a similar name (D-IC7: a guessed driver never
 * reaches a draft).
 */

export interface AttributionRow {
  id: string;
  source: AttributionSource;
  engine_version: string;
  created_at: string;
  outcome: AttributionOutcome;
  confidence: AttributionConfidence | null;
  basis: AttributionBasis | null;
  zone: string | null;
  zone_method: AttributionZoneMethod;
  started_at: string | null;
  ended_at: string | null;
  location_check: AttributionLocationCheck;
  vehicle_id: string | null;
  samsara_vehicle_id: string | null;
  samsara_driver_id: string | null;
  samsara_driver_name: string | null;
  candidates: { samsaraDriverId: string; name: string | null; passenger: boolean }[];
  decided_by: string | null;
  driver_id: string | null;
  note: string | null;
}

const COLS =
  "id, source, engine_version, created_at, outcome, confidence, basis, zone, zone_method, started_at, ended_at, location_check, " +
  "vehicle_id, samsara_vehicle_id, samsara_driver_id, samsara_driver_name, candidates, decided_by, driver_id, note";

export interface LatestAttribution {
  engine: AttributionRow | null;
  person: AttributionRow | null;
}

/** The latest row of each source. A newer engine version does not undo a person's decision; the page says which version it was over. */
export async function readLatestAttribution(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<LatestAttribution | { error: DbError }> {
  const latest = (source: AttributionSource) =>
    admin
      .from("inspection_attributions")
      .select(COLS)
      .eq("org_id", orgId)
      .eq("inspection_id", inspectionId)
      .eq("source", source)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const [engine, person] = await Promise.all([latest("engine"), latest("person")]);
  const failed = engine.error ?? person.error;
  if (failed) return { error: failed };
  return { engine: engine.data as AttributionRow | null, person: person.data as AttributionRow | null };
}

/** The row a decision must be made over: the newest of the two. */
export function currentRow(l: LatestAttribution): AttributionRow | null {
  if (!l.person) return l.engine;
  if (!l.engine) return l.person;
  return Date.parse(l.person.created_at) >= Date.parse(l.engine.created_at) ? l.person : l.engine;
}

interface DriverRow {
  id: string;
  full_name: string;
  samsara_driver_id: string | null;
}

/** Our drivers with these Samsara ids, and these roster ids. Two reads at most, none when nothing is asked. */
async function rosterOf(
  admin: SupabaseClient,
  orgId: string,
  samsaraIds: string[],
  ids: string[],
): Promise<{ bySamsara: Map<string, DriverRow>; byId: Map<string, DriverRow> } | { error: DbError }> {
  const read = (col: "samsara_driver_id" | "id", values: string[]) =>
    values.length
      ? admin.from("drivers").select("id, full_name, samsara_driver_id").eq("org_id", orgId).in(col, values)
      : Promise.resolve({ data: [] as DriverRow[], error: null });
  const [bySamsara, byId] = await Promise.all([read("samsara_driver_id", [...new Set(samsaraIds)]), read("id", [...new Set(ids)])]);
  const failed = bySamsara.error ?? byId.error;
  if (failed) return { error: failed };
  const rows = (r: { data: unknown }) => (r.data ?? []) as DriverRow[];
  return {
    bySamsara: new Map(rows(bySamsara).map((d) => [d.samsara_driver_id!, d])),
    byId: new Map(rows(byId).map((d) => [d.id, d])),
  };
}

const ref = (d: DriverRow | undefined): AttributionDriverRefDto | null => (d ? { id: d.id, name: d.full_name } : null);

/** The page's attribution: the reading with its drivers resolved, and the decision with its author named. */
export async function readInspectionAttribution(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<RoadsideAttributionDto | { error: DbError }> {
  const latest = await readLatestAttribution(admin, orgId, inspectionId);
  if ("error" in latest) return latest;
  const { engine, person } = latest;
  const candidates = engine?.candidates ?? [];
  const samsaraIds = [engine?.samsara_driver_id, ...candidates.map((c) => c.samsaraDriverId)].filter((s): s is string => !!s);
  const [roster, labels] = await Promise.all([
    rosterOf(admin, orgId, samsaraIds, person?.driver_id ? [person.driver_id] : []),
    memberLabels(admin, orgId, person?.decided_by ? [person.decided_by] : []),
  ]);
  if ("error" in roster) return roster;

  return {
    reading: engine && {
      id: engine.id,
      engineVersion: engine.engine_version,
      readAt: engine.created_at,
      outcome: engine.outcome,
      confidence: engine.confidence,
      basis: engine.basis,
      zone: engine.zone,
      zoneMethod: engine.zone_method,
      startedAt: engine.started_at,
      endedAt: engine.ended_at,
      locationCheck: engine.location_check,
      samsaraDriver: engine.samsara_driver_id ? { id: engine.samsara_driver_id, name: engine.samsara_driver_name } : null,
      driver: engine.samsara_driver_id ? ref(roster.bySamsara.get(engine.samsara_driver_id)) : null,
      candidates: candidates.map((c) => ({
        samsaraDriverId: c.samsaraDriverId,
        name: c.name,
        passenger: c.passenger,
        driver: ref(roster.bySamsara.get(c.samsaraDriverId)),
      })),
    },
    decision: person && {
      id: person.id,
      kind: person.driver_id ? "corrected" : "confirmed",
      driver: person.driver_id ? ref(roster.byId.get(person.driver_id)) : null,
      decidedBy: person.decided_by ? labelOf(labels.get(person.decided_by)) : null,
      decidedAt: person.created_at,
      note: person.note,
      engineVersion: person.engine_version,
    },
    basedOn: currentRow(latest)?.id ?? null,
  };
}
