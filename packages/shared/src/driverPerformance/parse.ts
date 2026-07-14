/**
 * Parse Samsara Safety-Score and Driver-Efficiency responses into normalized rows (pure, defensive —
 * mirrors parseIdlingEvents). No field is assumed present; unknown shapes are skipped, not thrown. The
 * exact modern field names are verified against a live sample in Phase B (docs/16 §9.1).
 */

const METERS_PER_MILE = 1609.344;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

const metersToMiles = (m: number | null | undefined): number | null =>
  m == null ? null : r1(m / METERS_PER_MILE);
const msToHours = (ms: number | null | undefined): number | null =>
  ms == null ? null : r2(ms / 3_600_000);

export interface SafetyScoreRow {
  samsaraDriverId: string;
  safetyScore: number | null;
  driveDistanceMi: number | null;
  driveTimeHours: number | null;
  harshAccelCount: number;
  harshBrakeCount: number;
  harshTurnCount: number;
  crashCount: number;
  speedingMs: number;
  behaviorsRaw: unknown;
  speedingRaw: unknown;
}

/** Parse `GET /safety-scores/drivers` → per-driver rows. Harsh/crash counts come from behaviors[]. */
export function parseSafetyScores(
  response: { data?: unknown[] } | null | undefined,
): SafetyScoreRow[] {
  const out: SafetyScoreRow[] = [];
  for (const raw of response?.data ?? []) {
    const e = raw as {
      driverId?: string | number;
      driverScore?: number | string;
      driveDistanceMeters?: number;
      driveTimeMilliseconds?: number;
      behaviors?: { behaviorType?: string; count?: number | string }[];
      speeding?: { durationMilliseconds?: number | string }[];
    };
    if (e.driverId == null) continue;
    const behaviors = Array.isArray(e.behaviors) ? e.behaviors : [];
    const countOf = (t: string) =>
      behaviors
        .filter((b) => b?.behaviorType === t)
        .reduce((s, b) => s + (Number(b?.count) || 0), 0);
    const speeding = Array.isArray(e.speeding) ? e.speeding : [];
    const score = e.driverScore == null ? null : Number(e.driverScore);
    out.push({
      samsaraDriverId: String(e.driverId),
      safetyScore: score != null && Number.isFinite(score) ? score : null,
      driveDistanceMi: metersToMiles(e.driveDistanceMeters ?? null),
      driveTimeHours: msToHours(e.driveTimeMilliseconds ?? null),
      harshAccelCount: countOf("acceleration"),
      harshBrakeCount: countOf("braking"),
      harshTurnCount: countOf("harshTurn"),
      crashCount: countOf("crash"),
      speedingMs: speeding.reduce((s, x) => s + (Number(x?.durationMilliseconds) || 0), 0),
      behaviorsRaw: behaviors,
      speedingRaw: speeding,
    });
  }
  return out;
}

/**
 * Normalize the Driver-Efficiency `overallScore`, which Samsara returns as a STRING that is either numeric
 * ("0"–"100") or a letter grade ("A"–"G") depending on org config. Numeric → score; letter → letter kept
 * (score null) so the component degrades gracefully rather than being mis-compared to numeric peers (§3.4).
 */
export function parseEfficiencyOverall(v: unknown): { score: number | null; letter: string | null } {
  if (v == null) return { score: null, letter: null };
  const s = String(v).trim();
  if (s === "") return { score: null, letter: null };
  const num = Number(s);
  if (Number.isFinite(num)) return { score: num, letter: null };
  const letter = s.toUpperCase();
  if (/^[A-G]$/.test(letter)) return { score: null, letter };
  return { score: null, letter: null };
}

export interface EfficiencyScoreRow {
  samsaraDriverId: string;
  efficiencyScore: number | null;
  efficiencyGradeLetter: string | null;
  engineOnHours: number | null;
  idlingPct: number | null;
  raw: unknown;
}

/** Parse `GET /driver-efficiency/drivers` (dataFormats=score,raw) → per-driver rows. */
export function parseDriverEfficiency(
  response: { data?: unknown[] } | null | undefined,
): EfficiencyScoreRow[] {
  const out: EfficiencyScoreRow[] = [];
  for (const raw of response?.data ?? []) {
    const e = raw as {
      driverId?: string | number;
      scoreData?: { overallScore?: unknown };
      rawData?: { engineOnDurationMs?: number | string };
      percentageData?: { idlingPercentage?: number | string };
    };
    if (e.driverId == null) continue;
    const overall = parseEfficiencyOverall(e.scoreData?.overallScore);
    const idle = e.percentageData?.idlingPercentage;
    out.push({
      samsaraDriverId: String(e.driverId),
      efficiencyScore: overall.score,
      efficiencyGradeLetter: overall.letter,
      engineOnHours: msToHours(e.rawData?.engineOnDurationMs == null ? null : Number(e.rawData.engineOnDurationMs)),
      idlingPct: idle == null ? null : r1(Number(idle)),
      raw,
    });
  }
  return out;
}
