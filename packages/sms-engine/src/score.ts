/**
 * What FMCSA's SMS scores from one carrier's roadside record at one measurement date — violation by
 * violation, with the reason for every one it leaves out (SMS Methodology v3.21 §2–3; INSPECTION-
 * CHALLENGE-PLAN IC3, D-IC6).
 *
 * ── THE RULES, EACH MEASURED AGAINST FMCSA'S OWN ANSWER ────────────────────────────────────────
 * `tests/parity.test.ts` runs this over our 2026-10-10 feed and compares it with the 741 violations
 * FMCSA's 2026-08-28 snapshot published as scored. In order:
 *   window       inspection date within the 24 months ending on the measurement date, inclusive.
 *   loaded       the inspection reached MCMIS BEFORE the measurement date. Two in-window inspections
 *                were added on or after it and FMCSA scored neither.
 *   appendix     the code is in the Appendix A edition in force (111 of ours are not, e.g. 392.2LV).
 *   level        the inspection is relevant to the code's BASIC (`BASIC_RULES`); ten are not.
 *   placard      HM Compliance counts only where placardable HM was carried; 23 were not.
 *   crash        on a post-crash inspection, a moving violation is the crash and does not count (§2.2
 *                fn. 8, `BASIC_RULES.crashRelated`); 4179180099's lane change, added 2026-10-13 (Q-IC9).
 *   dismissed    adjudicated citation code 3 removes the violation (Table 2-1).
 *   once         a code counts once per inspection; out-of-service if ANY occurrence was (§3).
 * Then weights: severity from Appendix A — 1 when convicted of a different charge (code 2), which
 * also drops the OOS weight — plus 2 for OOS where the BASIC takes it, times the time weight
 * 3 / 2 / 1 for 0–6 / 6–12 / 12–24 months. FMCSA's `total_severity_wght` is severity + OOS, before
 * time weighting; the 30-point cap applies to the inspection's BASIC sum (`basicPoints`).
 *
 * ── PURE ───────────────────────────────────────────────────────────────────────────────────────
 * No clock: the measurement date is an argument. No I/O: the caller maps its rows to `SmsInspection`.
 */
import { appendixFor, violationKey, type AppendixEdition } from "./appendix.js";
import { BASIC_RULES, INSPECTION_BASIC_CAP, OOS_WEIGHT, type SmsBasic } from "./basics.js";

/** FMCSA's adjudicated-citation codes (job aid AdjudicatedCitations2025): 1 original, 2 different, 3 dismissed. */
export type CitationResult = 1 | 2 | 3;

export interface SmsViolationInput {
  /** Caller's id for the violation, carried through so a result can be joined back. */
  id: string;
  code: string;
  outOfService: boolean;
  citationResult: CitationResult | null;
}

export interface SmsInspectionInput {
  id: string;
  /** YYYY-MM-DD, the inspection's own date. */
  date: string;
  level: number | null;
  hazmatPlacard: boolean | null;
  /** FMCSA's `post_acc_ind`: the inspection followed a crash. Null (not reported) is not a crash. */
  postAccident: boolean | null;
  /** YYYY-MM-DD, the day the inspection reached MCMIS (`mcmis_add_date`). */
  addedOn: string;
  violations: readonly SmsViolationInput[];
}

export type ExclusionReason =
  | "outside_window"
  | "not_loaded"
  | "not_in_appendix"
  | "level_not_relevant"
  | "hm_not_placardable"
  | "crash_related"
  | "dismissed"
  | "counted_once";

export interface ScoredViolation {
  /** Every input violation this scored line stands for (one, or several of the same code). */
  ids: string[];
  key: string;
  basic: SmsBasic;
  group: string;
  severityWeight: number;
  oosWeight: number;
  timeWeight: 1 | 2 | 3;
  /** Severity + OOS, before time weighting — FMCSA's `total_severity_wght`. */
  totalSeverityWeight: number;
}

export interface ScoredInspection {
  id: string;
  timeWeight: 1 | 2 | 3;
  violations: ScoredViolation[];
}

export interface SmsScore {
  measurementDate: string;
  appendixVersion: string;
  inspections: ScoredInspection[];
  excluded: { inspectionId: string; violationId: string | null; reason: ExclusionReason }[];
}

/** `date` minus `months`, the same day of the month, clamped to the month's last day. */
export function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** 3, 2 or 1 by age at the measurement date; null outside the 24-month window. Each boundary is inclusive of the newer bucket. */
export function timeWeight(date: string, measurementDate: string): 1 | 2 | 3 | null {
  if (date > measurementDate || date < monthsBefore(measurementDate, 24)) return null;
  if (date >= monthsBefore(measurementDate, 6)) return 3;
  if (date >= monthsBefore(measurementDate, 12)) return 2;
  return 1;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function scoreSms(
  inspections: readonly SmsInspectionInput[],
  measurementDate: string,
  appendix: AppendixEdition | null = appendixFor(measurementDate),
): SmsScore {
  if (!isoDate.test(measurementDate)) throw new Error(`measurement date must be YYYY-MM-DD, got ${measurementDate}`);
  if (!appendix) throw new Error(`no Appendix A edition is in force on ${measurementDate}`);
  const out: SmsScore = { measurementDate, appendixVersion: appendix.version, inspections: [], excluded: [] };
  const exclude = (inspectionId: string, violationId: string | null, reason: ExclusionReason) =>
    out.excluded.push({ inspectionId, violationId, reason });

  for (const insp of inspections) {
    const tw = isoDate.test(insp.date) ? timeWeight(insp.date, measurementDate) : null;
    if (tw === null) {
      exclude(insp.id, null, "outside_window");
      continue;
    }
    if (!(insp.addedOn < measurementDate)) {
      exclude(insp.id, null, "not_loaded");
      continue;
    }
    const byKey = new Map<string, ScoredViolation>();
    for (const v of insp.violations) {
      const key = violationKey(v.code);
      const def = appendix.byKey.get(key);
      if (!def) { exclude(insp.id, v.id, "not_in_appendix"); continue; }
      const rules = BASIC_RULES[def.basic];
      if (rules.levels && (insp.level === null || !rules.levels.has(insp.level))) { exclude(insp.id, v.id, "level_not_relevant"); continue; }
      if (rules.placardOnly && insp.hazmatPlacard !== true) { exclude(insp.id, v.id, "hm_not_placardable"); continue; }
      if (rules.crashRelated && insp.postAccident === true) { exclude(insp.id, v.id, "crash_related"); continue; }
      if (v.citationResult === 3) { exclude(insp.id, v.id, "dismissed"); continue; }
      const differentCharge = v.citationResult === 2;
      const severity = differentCharge ? 1 : def.severity;
      const oos = rules.oosWeight && v.outOfService && !differentCharge ? OOS_WEIGHT : 0;
      const seen = byKey.get(key);
      if (seen) {
        // The same code twice on one inspection counts once (§3). Neither FMCSA's text nor our record
        // says what happens when only one occurrence was convicted of a different charge; the line keeps
        // the heavier reading, which is the one a challenge must defeat.
        exclude(insp.id, v.id, "counted_once");
        seen.ids.push(v.id);
        seen.severityWeight = Math.max(seen.severityWeight, severity);
        seen.oosWeight = Math.max(seen.oosWeight, oos);
        seen.totalSeverityWeight = seen.severityWeight + seen.oosWeight;
        continue;
      }
      byKey.set(key, {
        ids: [v.id], key, basic: def.basic, group: def.group, severityWeight: severity, oosWeight: oos,
        timeWeight: tw, totalSeverityWeight: severity + oos,
      });
    }
    out.inspections.push({
      id: insp.id,
      timeWeight: tw,
      violations: [...byKey.values()],
    });
  }
  return out;
}

/**
 * One inspection's points in one BASIC: its severity sum capped at 30, then time-weighted — the
 * numerator the BASIC measure adds up (§3). Zero when it has no scored violation there.
 */
export function basicPoints(insp: ScoredInspection, basic: SmsBasic): { severitySum: number; capped: number; points: number } {
  const severitySum = insp.violations.filter((v) => v.basic === basic).reduce((s, v) => s + v.totalSeverityWeight, 0);
  const capped = Math.min(severitySum, INSPECTION_BASIC_CAP);
  return { severitySum, capped, points: capped * insp.timeWeight };
}
