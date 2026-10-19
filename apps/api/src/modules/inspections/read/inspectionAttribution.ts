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
import { readReportChecks } from "../report/readChecks.js";
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

export const ATTRIBUTION_COLS =
  "id, source, engine_version, created_at, outcome, confidence, basis, zone, zone_method, started_at, ended_at, location_check, " +
  "vehicle_id, samsara_vehicle_id, samsara_driver_id, samsara_driver_name, candidates, decided_by, driver_id, note";

export interface LatestAttribution {
  engine: AttributionRow | null;
  person: AttributionRow | null;
  /** The officer's report's confirmation (0479, IC10): written by the check, never by a person. */
  report: AttributionRow | null;
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
      .select(ATTRIBUTION_COLS)
      .eq("org_id", orgId)
      .eq("inspection_id", inspectionId)
      .eq("source", source)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const [engine, person, report] = await Promise.all([latest("engine"), latest("person"), latest("report")]);
  const failed = engine.error ?? person.error ?? report.error;
  if (failed) return { error: failed };
  return {
    engine: engine.data as AttributionRow | null,
    person: person.data as AttributionRow | null,
    report: report.data as AttributionRow | null,
  };
}

const newest = (rows: (AttributionRow | null)[]): AttributionRow | null =>
  rows.reduce<AttributionRow | null>((best, r) => (r && (!best || Date.parse(r.created_at) >= Date.parse(best.created_at)) ? r : best), null);

/** The latest decision over the reading: a person's or the report's, whichever is newer. */
export function decisionRow(l: LatestAttribution): AttributionRow | null {
  return newest([l.report, l.person]);
}

/** The row a decision must be made over: the newest of the three. */
export function currentRow(l: LatestAttribution): AttributionRow | null {
  return newest([l.engine, l.report, l.person]);
}

export interface DriverRow {
  id: string;
  full_name: string;
  samsara_driver_id: string | null;
}

/** Our drivers with these Samsara ids, and these roster ids. Two reads at most, none when nothing is asked. */
export async function rosterOf(
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

export const ref = (d: DriverRow | undefined): AttributionDriverRefDto | null => (d ? { id: d.id, name: d.full_name } : null);

export type Roster = { bySamsara: Map<string, DriverRow>; byId: Map<string, DriverRow> };

/** The Samsara ids and roster ids one inspection's latest rows name — what `rosterOf` must be asked. */
export function namedIds(latest: LatestAttribution): { samsara: string[]; roster: string[] } {
  const { engine } = latest;
  const person = decisionRow(latest);
  const samsara = [engine?.samsara_driver_id, ...(engine?.candidates ?? []).map((c) => c.samsaraDriverId)].filter((x): x is string => !!x);
  return { samsara, roster: person?.driver_id ? [person.driver_id] : [] };
}

/**
 * The attribution DTO from one inspection's latest rows, with the roster and the deciders already read — one
 * builder for the inspection page (`readInspectionAttribution`) and the inbox (`inspectionsWork.ts`), so the
 * two cannot name a driver differently. Pure.
 */
export function attributionDto(
  latest: LatestAttribution,
  roster: Roster,
  labels: Awaited<ReturnType<typeof memberLabels>>,
  reports: RoadsideAttributionDto["reports"],
): RoadsideAttributionDto {
  const { engine } = latest;
  const person = decisionRow(latest);
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
      candidates: (engine.candidates ?? []).map((c) => ({
        samsaraDriverId: c.samsaraDriverId,
        name: c.name,
        passenger: c.passenger,
        driver: ref(roster.bySamsara.get(c.samsaraDriverId)),
      })),
    },
    decision: person && {
      id: person.id,
      kind: person.source === "report" ? "confirmed_by_report" : person.driver_id ? "corrected" : "confirmed",
      driver: person.driver_id ? ref(roster.byId.get(person.driver_id)) : null,
      decidedBy: person.decided_by ? labelOf(labels.get(person.decided_by)) : null,
      decidedAt: person.created_at,
      note: person.note,
      engineVersion: person.engine_version,
    },
    basedOn: currentRow(latest)?.id ?? null,
    reports,
  };
}

/** The page's attribution: the reading with its drivers resolved, and the decision with its author named. */
export async function readInspectionAttribution(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<RoadsideAttributionDto | { error: DbError }> {
  const latest = await readLatestAttribution(admin, orgId, inspectionId);
  if ("error" in latest) return latest;
  const person = decisionRow(latest);
  const ids = namedIds(latest);
  const [roster, labels] = await Promise.all([
    rosterOf(admin, orgId, ids.samsara, ids.roster),
    memberLabels(admin, orgId, person?.decided_by ? [person.decided_by] : []),
  ]);
  if ("error" in roster) return roster;
  // A failure here degrades the card to "no report" rather than failing the page: the reading and the
  // decision are what the page is for, and on staging this read can meet the code before its table (0480)
  // is applied (`check-migration-ordering.mjs`'s window).
  const reports = await readReportChecks(admin, orgId, inspectionId, async (id) => {
    const known = roster.byId.get(id);
    if (known) return ref(known);
    const r = await rosterOf(admin, orgId, [], [id]);
    return "error" in r ? null : ref(r.byId.get(id));
  }).catch((e: unknown) => {
    console.error(`[inspection-report] org ${orgId} inspection ${inspectionId}: report checks unread —`, e instanceof Error ? e.message : e);
    return [];
  });
  return attributionDto(latest, roster, labels, reports);
}
