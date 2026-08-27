/**
 * ENTITY INTELLIGENCE (2026-08 plan, Phases 1–2).
 *
 * Phase 1 — `loadEntityRiskContext`: a derived-on-read risk snapshot for the entities behind a case
 * (driver / vehicle / card). No counter table to drift: the source data already exists — anomalies
 * carry workflow + reviewer disposition (0034), every fill persists its case outcome INCLUDING
 * sub-threshold signals (WP2's "why clear" surface), and declines carry suspicion levels. The
 * snapshot is CONTEXT for the reviewer ("this driver: 2 confirmed incidents, 7 near-miss fills in
 * 90d"), never a score input — history becomes a correlation axis only after the disposition loop
 * proves it predicts confirmed fraud (Phase 3, deliberately gated).
 *
 * Phase 2 — `runPatternSweep`: the flag-triggered retrospective analysis. When a case reaches alert
 * level, a read-only background job sweeps the entity's trailing window for the patterns a per-fill
 * scorer structurally cannot see: recurring sub-threshold signal combinations, near-threshold fills
 * over time, station concentration, and decline→success sequences (card testing). Output is a
 * deterministic report attached to the case as EVIDENCE — it raises no alerts and touches no scores.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A fill whose case stayed "clear" but scored at least this is a NEAR-THRESHOLD fill (review is 60). */
export const NEAR_THRESHOLD_SCORE = 40;
/** Risk-context windows (days). */
export const RISK_DISPOSITION_WINDOW_DAYS = 180;
export const RISK_ACTIVITY_WINDOW_DAYS = 90;
/** Sweep lookback (days) and page size. */
export const SWEEP_LOOKBACK_DAYS = 180;
const PAGE = 1000;
/** A decline followed by an approved fill on the same card within this window = one retry sequence. */
const DECLINE_RETRY_WINDOW_MIN = 90;

export interface EntityRiskEntry {
  /** Open (unresolved) theft cases attached to this entity right now. */
  openCases: number;
  /** Reviewer-confirmed cases in the disposition window — the ground-truth history. */
  confirmed: number;
  /** Reviewer-rejected cases (false_positive + benign_explained) in the disposition window. */
  rejected: number;
  /** Fills whose case stayed CLEAR but scored ≥ NEAR_THRESHOLD_SCORE in the activity window. */
  nearThresholdFills: number;
  /** Declines flagged suspicious in the activity window. */
  suspiciousDeclines: number;
}

export interface EntityRiskContext {
  driver: EntityRiskEntry | null;
  vehicle: EntityRiskEntry | null;
  card: EntityRiskEntry | null;
  windows: { dispositionDays: number; activityDays: number; nearThresholdScore: number };
}

const emptyEntry = (): EntityRiskEntry => ({
  openCases: 0, confirmed: 0, rejected: 0, nearThresholdFills: 0, suspiciousDeclines: 0,
});

async function countExact(q: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await q;
  return count ?? 0;
}

/** Case counts for one entity axis, resolved through the fills the entity owns. */
async function entityEntry(
  admin: SupabaseClient,
  orgId: string,
  axis: "driver_id" | "vehicle_id" | "card_ref",
  value: string,
): Promise<EntityRiskEntry> {
  const dispFromIso = new Date(Date.now() - RISK_DISPOSITION_WINDOW_DAYS * 86_400_000).toISOString();
  const actFromIso = new Date(Date.now() - RISK_ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString();

  // Anomalies don't carry driver/card directly — resolve the entity's transaction ids first (bounded
  // to the disposition window; paged once — an entity rarely exceeds 1000 fills in 180d).
  const { data: txns } = await admin
    .from("fuel_transactions")
    .select("id")
    .eq("org_id", orgId)
    .eq(axis, value)
    .gte("fueled_at", dispFromIso)
    .order("fueled_at", { ascending: false })
    .limit(PAGE);
  const txnIds = ((txns ?? []) as { id: string }[]).map((t) => t.id);

  const entry = emptyEntry();
  if (txnIds.length) {
    entry.openCases = await countExact(
      admin.from("anomalies").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).in("transaction_id", txnIds.slice(0, 200))
        .in("status", ["open", "investigating"]),
    );
    entry.confirmed = await countExact(
      admin.from("anomalies").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).in("transaction_id", txnIds.slice(0, 200))
        .eq("disposition", "confirmed"),
    );
    entry.rejected = await countExact(
      admin.from("anomalies").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).in("transaction_id", txnIds.slice(0, 200))
        .in("disposition", ["false_positive", "benign_explained"]),
    );
  }
  entry.nearThresholdFills = await countExact(
    admin.from("fuel_transactions").select("id", { count: "exact", head: true })
      .eq("org_id", orgId).eq(axis, value)
      .gte("fueled_at", actFromIso)
      .eq("case_level", "clear")
      .gte("case_score", NEAR_THRESHOLD_SCORE),
  );
  if (axis === "card_ref") {
    entry.suspiciousDeclines = await countExact(
      admin.from("declined_transactions").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).eq("card_ref", value)
        .gte("declined_at", actFromIso)
        .not("suspicion_level", "in", "(clear)")
        .not("suspicion_level", "is", null),
    );
  }
  return entry;
}

/** Phase 1 — the reviewer-facing risk snapshot for a case's entities. Pure reads, no persistence. */
export async function loadEntityRiskContext(
  admin: SupabaseClient,
  orgId: string,
  entities: { driverId?: string | null; vehicleId?: string | null; cardRef?: string | null },
): Promise<EntityRiskContext> {
  const [driver, vehicle, card] = await Promise.all([
    entities.driverId ? entityEntry(admin, orgId, "driver_id", entities.driverId) : Promise.resolve(null),
    entities.vehicleId ? entityEntry(admin, orgId, "vehicle_id", entities.vehicleId) : Promise.resolve(null),
    entities.cardRef ? entityEntry(admin, orgId, "card_ref", entities.cardRef) : Promise.resolve(null),
  ]);
  return {
    driver, vehicle, card,
    windows: {
      dispositionDays: RISK_DISPOSITION_WINDOW_DAYS,
      activityDays: RISK_ACTIVITY_WINDOW_DAYS,
      nearThresholdScore: NEAR_THRESHOLD_SCORE,
    },
  };
}

// ── Phase 2 — the retrospective pattern sweep ────────────────────────────────────────────────────

interface SweepFillRow {
  id: string;
  fueled_at: string;
  gallons: number | string;
  case_level: string | null;
  case_score: number | null;
  case_signals: { ruleId: string; weight?: number }[] | null;
  state: string | null;
  location_text: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  card_ref: string | null;
}

/** Trailing fills for one entity axis, paged, oldest first. */
async function loadSweepFills(
  admin: SupabaseClient,
  orgId: string,
  axis: "driver_id" | "vehicle_id" | "card_ref",
  value: string,
  fromIso: string,
): Promise<SweepFillRow[]> {
  const out: SweepFillRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, fueled_at, gallons, case_level, case_score, case_signals, state, location_text, driver_id, vehicle_id, card_ref")
      .eq("org_id", orgId)
      .eq(axis, value)
      .gte("fueled_at", fromIso)
      .order("fueled_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as SweepFillRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function analyzeFills(fills: SweepFillRow[]) {
  const signalCounts: Record<string, number> = {};
  const levelCounts: Record<string, number> = { clear: 0, review: 0, alert: 0 };
  const nearThreshold: { fueledAt: string; score: number; signals: string[] }[] = [];
  const stationCounts: Record<string, number> = {};
  let totalGallons = 0;
  for (const f of fills) {
    totalGallons += Number(f.gallons) || 0;
    const level = f.case_level ?? "clear";
    levelCounts[level] = (levelCounts[level] ?? 0) + 1;
    for (const s of f.case_signals ?? []) signalCounts[s.ruleId] = (signalCounts[s.ruleId] ?? 0) + 1;
    if (level === "clear" && (f.case_score ?? 0) >= NEAR_THRESHOLD_SCORE) {
      nearThreshold.push({
        fueledAt: f.fueled_at,
        score: f.case_score ?? 0,
        signals: (f.case_signals ?? []).map((s) => s.ruleId),
      });
    }
    const station = f.location_text ?? (f.state ? `?, ${f.state}` : null);
    if (station) stationCounts[station] = (stationCounts[station] ?? 0) + 1;
  }
  const topStations = Object.entries(stationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([station, count]) => ({ station, count, share: fills.length ? Math.round((count / fills.length) * 100) : 0 }));
  const recurringSignals = Object.entries(signalCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ruleId, count]) => ({ ruleId, count }));
  return {
    fills: fills.length,
    totalGallons: Math.round(totalGallons * 10) / 10,
    levelCounts,
    recurringSignals,
    nearThresholdTimeline: nearThreshold.slice(-20), // most recent 20
    nearThresholdTotal: nearThreshold.length,
    topStations,
  };
}

/** Decline→success sequences for a card: a suspicious pattern precursor (card testing / limit probing). */
async function declineRetrySequences(
  admin: SupabaseClient,
  orgId: string,
  cardRef: string,
  fromIso: string,
): Promise<{ total: number; suspicious: number; sequences: { declinedAt: string; errorCode: string | null; fillAt: string | null; minutesToFill: number | null }[] }> {
  const { data } = await admin
    .from("declined_transactions")
    .select("declined_at, error_code, suspicion_level, card_ref")
    .eq("org_id", orgId)
    .eq("card_ref", cardRef)
    .gte("declined_at", fromIso)
    .order("declined_at", { ascending: true })
    .limit(PAGE);
  const declines = (data ?? []) as { declined_at: string; error_code: string | null; suspicion_level: string | null }[];
  if (!declines.length) return { total: 0, suspicious: 0, sequences: [] };
  const { data: fillsData } = await admin
    .from("fuel_transactions")
    .select("fueled_at")
    .eq("org_id", orgId)
    .eq("card_ref", cardRef)
    .gte("fueled_at", fromIso)
    .order("fueled_at", { ascending: true })
    .limit(PAGE);
  const fillTimes = ((fillsData ?? []) as { fueled_at: string }[]).map((f) => Date.parse(f.fueled_at));
  const sequences = declines.map((d) => {
    const dMs = Date.parse(d.declined_at);
    const next = fillTimes.find((t) => t >= dMs && t - dMs <= DECLINE_RETRY_WINDOW_MIN * 60_000) ?? null;
    return {
      declinedAt: d.declined_at,
      errorCode: d.error_code,
      fillAt: next != null ? new Date(next).toISOString() : null,
      minutesToFill: next != null ? Math.round((next - dMs) / 60_000) : null,
    };
  });
  return {
    total: declines.length,
    suspicious: declines.filter((d) => d.suspicion_level && d.suspicion_level !== "clear").length,
    sequences: sequences.slice(-25),
  };
}

export interface PatternSweepResult {
  anomalyId: string;
  generated: boolean;
  reason?: string;
}

/**
 * Phase 2 entry point — analyze the entities behind one case and persist the report (upsert; a
 * re-sweep replaces). READ-ONLY against scoring data: it writes only case_pattern_reports, so it
 * needs no scoring mutex and can never disturb detection outcomes.
 */
export async function runPatternSweep(
  admin: SupabaseClient,
  orgId: string,
  anomalyId: string,
  lookbackDays: number = SWEEP_LOOKBACK_DAYS,
): Promise<PatternSweepResult> {
  const { data: anom } = await admin
    .from("anomalies")
    .select("id, transaction_id, vehicle_id")
    .eq("id", anomalyId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!anom?.transaction_id) return { anomalyId, generated: false, reason: "anomaly or transaction not found" };
  const { data: txn } = await admin
    .from("fuel_transactions")
    .select("id, driver_id, vehicle_id, card_ref, fueled_at")
    .eq("id", anom.transaction_id as string)
    .maybeSingle();
  if (!txn) return { anomalyId, generated: false, reason: "transaction not found" };

  const t = txn as { driver_id: string | null; vehicle_id: string | null; card_ref: string | null; fueled_at: string };
  const fromIso = new Date(Date.parse(t.fueled_at) - lookbackDays * 86_400_000).toISOString();

  const [vehicleFills, driverFills, cardDeclines] = await Promise.all([
    t.vehicle_id ? loadSweepFills(admin, orgId, "vehicle_id", t.vehicle_id, fromIso) : Promise.resolve([]),
    t.driver_id ? loadSweepFills(admin, orgId, "driver_id", t.driver_id, fromIso) : Promise.resolve([]),
    t.card_ref ? declineRetrySequences(admin, orgId, t.card_ref, fromIso) : Promise.resolve(null),
  ]);

  const report = {
    version: 1,
    lookbackDays,
    anchorFueledAt: t.fueled_at,
    vehicle: t.vehicle_id ? analyzeFills(vehicleFills) : null,
    driver: t.driver_id ? analyzeFills(driverFills) : null,
    cardDeclines,
  };

  const { error } = await admin.from("case_pattern_reports").upsert(
    {
      org_id: orgId,
      anomaly_id: anomalyId,
      vehicle_id: t.vehicle_id,
      driver_id: t.driver_id,
      card_ref: t.card_ref,
      lookback_days: lookbackDays,
      report,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "anomaly_id" },
  );
  if (error) throw new Error(error.message);
  return { anomalyId, generated: true };
}
