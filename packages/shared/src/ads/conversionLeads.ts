import type { LeadOutcomeStage, LeadSourceOutcome } from "./leadOutcomes.js";

/**
 * Whether a carrier is ready for Meta's qualified-lead goal ("Conversion Leads"; ADS-PLATFORM-V2-PLAN V7e). SHOWN,
 * never offered: the switch waits on Q-AD17 (does an EMPLOYMENT campaign accept the goal? Meta's pages do not say,
 * and only the sandbox can), and Meta's pages do not name the goal's API value either. Pure — the api reads, this
 * folds.
 *
 * ── WHAT META ASKS, READ 2026-11-20 (Conversions API › Conversion Leads integration and its CRM steps) ──
 *   · "Generate at least 200 leads per month" — calendar month or rolling is not said; we count the last 30 days.
 *   · "Upload data at least once a day" — the outcome feed's daily run; it runs only with the feed on and a dataset.
 *   · "Your Lead Coverage is at least 60%", "the percentage of leads that have matching events uploaded to Meta" —
 *     we count, of the Meta leads that arrived in the last 30 days, those with at least one event Meta ACCEPTED
 *     (`ads_outcome_events.status = 'sent'`). Meta's own figure (Events Manager) is the authority; ours is what we
 *     sent, so ours can only be higher than Meta's if Meta drops an accepted event.
 *   · "The lead stage you want to optimize for occurs within 28 days after you generate the leads" and "has a
 *     conversion rate between 1% and 40%" — measured per stage on the leads that arrived 29 to 58 days ago (a
 *     30-day cohort every member of which has had its full 28 days), counting a stage reached within 28 days.
 * Each check is met, not met, or not measurable yet (`null`) — a cohort with no lead says nothing either way.
 */

export const CONVERSION_LEADS_MIN_MONTHLY = 200;
export const CONVERSION_LEADS_MIN_COVERAGE = 0.6;
export const CONVERSION_LEADS_STAGE_DAYS = 28;
export const CONVERSION_LEADS_RATE_MIN = 0.01;
export const CONVERSION_LEADS_RATE_MAX = 0.4;
export const CONVERSION_LEADS_WINDOW_DAYS = 30;

/** The stages Meta could be asked to optimise for: a positive step forward, never a close. */
export const OPTIMISABLE_STAGES = ["contacted", "qualified", "converted", "applied", "hired"] as const satisfies readonly LeadOutcomeStage[];
export type OptimisableStage = (typeof OPTIMISABLE_STAGES)[number];

export interface ConversionLeadsCheck {
  key: "volume" | "feed" | "coverage" | "stage" | "employment";
  /** True met, false not met, null not measurable yet / not answered. */
  met: boolean | null;
  /** What we measured, in office words. */
  measured: string;
  /** What Meta asks, in office words. */
  needs: string;
}

export interface StageRate { stage: OptimisableStage; reached: number; of: number; rate: number | null; in_range: boolean | null }

export interface ConversionLeadsView {
  checked_at: string;
  /** Never true until Q-AD17 is answered on the sandbox; the switch is not built. */
  offered: false;
  checks: ConversionLeadsCheck[];
  stage_rates: StageRate[];
}

export interface ConversionLeadsInput {
  now: Date;
  /** Meta leads (channel `meta`) that arrived in the last 30 days. */
  recent: readonly LeadSourceOutcome[];
  /** Meta leads that arrived 29 to 58 days ago. */
  cohort: readonly LeadSourceOutcome[];
  /** Lead ids with at least one event Meta accepted. */
  covered: ReadonlySet<string>;
  feed: { enabled: boolean; dataset_id: string | null };
}

const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;

export function stageRates(cohort: readonly LeadSourceOutcome[]): StageRate[] {
  const within = (l: LeadSourceOutcome, at: string | undefined) =>
    at !== undefined && Date.parse(at) - Date.parse(l.arrived_at) <= CONVERSION_LEADS_STAGE_DAYS * 86_400_000;
  return OPTIMISABLE_STAGES.map((stage) => {
    const reached = cohort.filter((l) => within(l, l.reached[stage])).length;
    const of = cohort.length;
    const rate = of === 0 ? null : reached / of;
    return { stage, reached, of, rate, in_range: rate === null ? null : rate >= CONVERSION_LEADS_RATE_MIN && rate <= CONVERSION_LEADS_RATE_MAX };
  });
}

export function conversionLeadsReadiness(input: ConversionLeadsInput): ConversionLeadsView {
  const n = input.recent.length;
  const covered = input.recent.filter((l) => input.covered.has(l.lead_id)).length;
  const coverage = n === 0 ? null : covered / n;
  const rates = stageRates(input.cohort);
  const inRange = rates.filter((r) => r.in_range === true);
  const feedOn = input.feed.enabled && input.feed.dataset_id !== null;
  const checks: ConversionLeadsCheck[] = [
    {
      key: "volume", met: n >= CONVERSION_LEADS_MIN_MONTHLY,
      measured: `${n} Meta leads in the last ${CONVERSION_LEADS_WINDOW_DAYS} days`,
      needs: `At least ${CONVERSION_LEADS_MIN_MONTHLY} leads a month`,
    },
    {
      key: "feed", met: feedOn,
      measured: feedOn ? "The outcome feed is on and names a Meta dataset" : "The outcome feed is off, or names no Meta dataset",
      needs: "Each lead and its stages sent to Meta at least once a day",
    },
    {
      key: "coverage", met: coverage === null ? null : coverage >= CONVERSION_LEADS_MIN_COVERAGE,
      measured: coverage === null ? "No Meta lead in the last 30 days to measure" : `${covered} of ${n} leads (${pct(coverage)}) have an event Meta accepted`,
      needs: `At least ${pct(CONVERSION_LEADS_MIN_COVERAGE)} of leads with an event uploaded`,
    },
    {
      key: "stage", met: input.cohort.length === 0 ? null : inRange.length > 0,
      measured: input.cohort.length === 0
        ? "No Meta lead old enough to measure (29 to 58 days)"
        : inRange.length > 0 ? `In range: ${inRange.map((r) => `${r.stage} ${pct(r.rate!)}`).join(", ")}` : "No stage between 1 % and 40 % within 28 days",
      needs: "A stage reached by 1 % to 40 % of leads within 28 days",
    },
    {
      key: "employment", met: null,
      measured: "Not answered: Meta's pages do not say whether a job ad (EMPLOYMENT) may use this goal; the sandbox run answers it (Q-AD17)",
      needs: "Meta accepts the goal for a job ad",
    },
  ];
  return { checked_at: input.now.toISOString(), offered: false, checks, stage_rates: rates };
}

