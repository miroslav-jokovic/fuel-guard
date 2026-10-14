import {
  INSPECTION_BASIC_CAP,
  SMS_BASICS,
  appendixFor,
  basicPoints,
  scoreSms,
  smsImpactVerified,
  violationKey,
  type CitationResult,
  type ExclusionReason,
  type SmsBasic,
} from "@silvicom/sms-engine";
import type {
  CalendarDay,
  RoadsideInspectionSmsDto,
  RoadsideSmsBasicDto,
  RoadsideViolationSmsDto,
  SmsBasicId,
  SmsExclusionReason,
} from "@silvicom/shared";

/**
 * One inspection's CSA points, measured today — `@silvicom/sms-engine` run over the Inspection page's
 * record, and its answer reshaped for the page (INSPECTION-CHALLENGE-PLAN §6, D-IC6; the contract is
 * `roadsideSmsContract.ts`).
 *
 * ── THE ENGINE DECIDES EVERY NUMBER AND EVERY REASON ───────────────────────────────────────────
 * Nothing here weighs a violation. `scoreSms` says what counts and why the rest does not; `basicPoints`
 * applies the 30-point cap; `smsImpactVerified` says which BASICs may show a figure at all (D-IC6: HM
 * Compliance may not, plan Q-IC9). This file only joins the answer back to violation ids, and fills
 * in the BASIC an excluded code belongs to from the same Appendix A edition the engine scored with.
 */

/** Holds the shared contract's keys to the engine's: a BASIC or reason added on one side only fails typecheck. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type SmsKeysAgree = Assert<Same<SmsBasic, SmsBasicId>> | Assert<Same<ExclusionReason, SmsExclusionReason>>;

export interface SmsInspectionFacts {
  id: string;
  date: CalendarDay | null;
  level: number | null;
  hazmatPlacard: boolean | null;
  postAccident: boolean | null;
  /** FMCSA's `mcmis_add_date`, YYYYMMDD with a clock after it as served; null when the raw row lacks it. */
  mcmisAddDate: string | null;
  violations: readonly { id: string; code: string | null; outOfService: boolean | null; citationCode: number | null }[];
}

const asCitation = (code: number | null): CitationResult | null => (code === 1 || code === 2 || code === 3 ? code : null);

/** `20261009 2143` → `2026-10-09`; anything else → null. */
function addedOn(raw: string | null): string | null {
  const m = raw?.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Null for an undated inspection (the engine would call it "older than 24 months", which nobody knows)
 * and on a day no Appendix A edition is in force, where scoring would be a guess.
 */
export function inspectionSms(insp: SmsInspectionFacts, today: CalendarDay): RoadsideInspectionSmsDto | null {
  const appendix = appendixFor(today);
  if (!insp.date || !appendix) return null;
  const score = scoreSms(
    [
      {
        id: insp.id,
        date: insp.date,
        level: insp.level,
        hazmatPlacard: insp.hazmatPlacard,
        postAccident: insp.postAccident,
        // A record without its load date is one FMCSA's feed served us, so it was in MCMIS before today;
        // the empty string sorts before every date, which is that reading.
        addedOn: addedOn(insp.mcmisAddDate) ?? "",
        violations: insp.violations.map((v) => ({
          id: v.id,
          code: v.code ?? "",
          outOfService: v.outOfService === true,
          citationResult: asCitation(v.citationCode),
        })),
      },
    ],
    today,
    appendix,
  );
  const scored = score.inspections[0];

  const violations: Record<string, RoadsideViolationSmsDto> = {};
  for (const line of scored?.violations ?? []) {
    // A repeated code's other ids are in `excluded` as `counted_once`; the line belongs to the first.
    const first = line.ids[0]!;
    violations[first] = smsImpactVerified(line.basic)
      ? {
          status: "scored",
          basic: line.basic,
          severityWeight: line.severityWeight,
          oosWeight: line.oosWeight,
          timeWeight: line.timeWeight,
          points: line.totalSeverityWeight * line.timeWeight,
        }
      : { status: "withheld", basic: line.basic };
  }
  const basicOf = (code: string | null) => (code ? (appendix.byKey.get(violationKey(code))?.basic ?? null) : null);
  for (const e of score.excluded) {
    // An inspection-wide exclusion (outside the window, not yet loaded) carries no violation id: it is
    // every violation's reason.
    for (const v of insp.violations) {
      if (e.violationId !== null && e.violationId !== v.id) continue;
      violations[v.id] = { status: "excluded", basic: basicOf(v.code), reason: e.reason };
    }
  }

  const basics: RoadsideSmsBasicDto[] = [];
  if (scored) {
    for (const basic of SMS_BASICS) {
      if (!scored.violations.some((l) => l.basic === basic)) continue;
      basics.push(smsImpactVerified(basic) ? { basic, verified: true, ...basicPoints(scored, basic) } : { basic, verified: false });
    }
  }

  return {
    measuredOn: today,
    appendixVersion: score.appendixVersion,
    timeWeight: scored?.timeWeight ?? null,
    cap: INSPECTION_BASIC_CAP,
    basics,
    violations,
  };
}
