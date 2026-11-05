/**
 * Monitor golden scenario schema (@silvicom/ads-golden; ADS-AGENT-BUILD-WORKFLOW.md §4R, the Monitor's L3 bar:
 * "each rule fires exactly at its threshold and minimum spend, never on a learning-phase ad set except caps;
 * reconcile flags every planted mismatch and nothing else").
 *
 * ── WHY NOT `schema.ts` ──────────────────────────────────────────────────────────────────────────
 * `schema.ts` is a campaign's timeline through the orchestrator: people, ticks, crashes, a ledger of moves. A
 * monitor scenario is what META reports and which jobs read it: hours, a learning stage, an edit made in Ads
 * Manager, what was paused and what was flagged. Hardly a key is shared, and the strict schema there is what
 * stops an orchestrator scenario lying, so branches in it would weaken it for both. These files live in
 * `scenarios/monitor/`, which `loadScenarios` does not descend into, so the orchestrator never sees them.
 *
 * The header of `schema.ts` holds for this file too: data only, the runner beside what it drives
 * (`apps/api/src/testing/adsMonitorGolden.ts`), and THE INDEPENDENCE RULE. `expect` is written from
 * `monitorChecks.ts` and `adsReconcile.ts`, never pasted from a run.
 */

import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/, "a short lower-case id, e.g. over");
const cents = z.number().int().nonnegative();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a local day, YYYY-MM-DD");
const hour = z.number().int().min(0).max(23);
const metaStatus = z.enum(["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"]);
/** `none` = Meta returns no stage for this ad set, which `monitorChecks.ts` reads as not learning. */
const stage = z.enum(["LEARNING", "SUCCESS", "FAIL", "none"]);

/** The thresholds in force; every scenario starts from these unless it says otherwise. */
export const monitorSettingsSchema = z
  .object({
    monthly_cap_cents: cents.default(300_000),
    cpl_max_cents: cents.nullable().default(4_200),
    cpl_min_leads: z.number().int().min(1).nullable().default(3),
    no_lead_spend_cents: cents.nullable().default(7_500),
    frequency_max: z.number().positive().nullable().default(4),
    pause_at_daily_cap: z.boolean().default(true),
  })
  .strict();

export const monitorCampaignSchema = z
  .object({
    id,
    /** A `CampaignState`, checked by the runner against `@silvicom/shared`. */
    state: z.string().min(1).default("live"),
    daily_budget_cents: cents.nullable().default(5_000),
    lifetime_cap_cents: cents.nullable().default(50_000),
    stage: stage.default("SUCCESS"),
    /** Meta's 7-day frequency; omitted = nothing reported. */
    frequency: z.number().nonnegative().optional(),
  })
  .strict();

const reportSchema = z
  .object({
    campaign: id,
    /** The account's local day and hour. Default: the clock's local day, 09:00. Reported again = Meta revised it. */
    day: day.optional(),
    hour: hour.default(9),
    spend_cents: cents,
    leads: z.number().int().nonnegative().default(0),
  })
  .strict();

/** Exactly one edit per step. A cents field of null removes the amount at Meta. */
const adsManagerSchema = z
  .object({
    campaign: id,
    status: metaStatus.optional(),
    adset_status: metaStatus.optional(),
    daily_budget_cents: cents.nullable().optional(),
    spend_cap_cents: cents.nullable().optional(),
    /** The object no longer exists: Meta answers "does not exist" for it. */
    remove: z.enum(["campaign", "adset"]).optional(),
  })
  .strict()
  .refine((e) => Object.keys(e).length === 2, { message: "ads_manager makes one edit per step" });

/** One step of the timeline. Exactly one key per step. */
export const monitorStepSchema = z.union([
  /** Meta reports this hour, as of now (a first report, a late hour, or a revision of one it reported). */
  z.object({ meta_reports: reportSchema }).strict(),
  /** Meta stops reporting an hour it reported before. */
  z.object({ meta_forgets: z.object({ campaign: id, day: day.optional(), hour: hour.default(9) }).strict() }).strict(),
  /** Meta's own figure for the account's month. */
  z.object({ account_month: cents }).strict(),
  z.object({ stage: z.object({ campaign: id, stage }).strict() }).strict(),
  z.object({ frequency: z.object({ campaign: id, value: z.number().nonnegative() }).strict() }).strict(),
  /** Someone edits one of our objects in Ads Manager. */
  z.object({ ads_manager: adsManagerSchema }).strict(),
  /** A campaign on the account with no row of ours. `named_as_ours`: its name parses as one of ours. */
  z.object({ foreign_campaign: z.object({ id, status: metaStatus, named_as_ours: z.boolean().default(false) }).strict() }).strict(),
  /** The `ads_insights` job: the pull, then the checks over what it brought. */
  z.object({ hourly_job: z.literal(true) }).strict(),
  /** The `ads_reconcile` job: the 28-day re-read, then the comparison. */
  z.object({ daily_reconcile: z.literal(true) }).strict(),
  z.object({ advance: z.object({ hours: z.number().optional(), days: z.number().optional() }).strict() }).strict(),
]);

export const monitorExpectSchema = z
  .object({
    /** Every campaign's final state. */
    states: z.record(id, z.string()),
    /**
     * EVERY pause of the run, as the ledger holds it: `run <n>: <campaign> <rule> <measured> > <threshold>`,
     * where n counts `hourly_job` steps. A pause this list does not name fails the scenario.
     */
    pauses: z.array(z.string()).default([]),
    /**
     * EVERY `external_change` row: `run <n>: <who> <level> <field> <ours> -> <theirs> <severity>`, where n counts
     * `daily_reconcile` steps, who is our campaign or a `foreign_campaign`'s id, and a missing value reads `none`.
     */
    flags: z.array(z.string()).default([]),
    /** EVERY alert that reached the bell: `<category> <severity>`. */
    bell: z.array(z.string()).default([]),
    /** EVERY failure a job reported: `reconcile <n>: <campaign> <reason>`, or `hourly <n>: …`. A job that reports one throws. */
    failures: z.array(z.string()).default([]),
  })
  .strict();

export const monitorScenarioSchema = z
  .object({
    name: z.string().min(1),
    /** What the scenario proves, and which rule the expectation was written from. */
    why: z.string().min(1),
    /** The §4R Monitor rows it covers (`daily_cap`, `learning`, `overrun`…). */
    covers: z.array(z.string().min(1)).min(1),
    /** Who wrote the expectation (the independence rule). */
    verifiedBy: z.string().min(1),
    /** 14:00 in Chicago on a Thursday in the middle of the month, unless the case is about the clock. */
    start: z.iso.datetime().default("2026-11-12T20:00:00.000Z"),
    settings: monitorSettingsSchema.prefault({}),
    campaigns: z.array(monitorCampaignSchema).min(1),
    timeline: z.array(monitorStepSchema).min(1),
    expect: monitorExpectSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.campaigns.map((c) => c.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "campaign ids must be unique" });
    const known = new Set(ids);
    for (const t of s.timeline) {
      for (const v of Object.values(t as Record<string, unknown>)) {
        const named = v && typeof v === "object" ? (v as { campaign?: unknown }).campaign : undefined;
        if (typeof named === "string" && !known.has(named)) ctx.addIssue({ code: "custom", message: `names campaign "${named}", which the scenario does not seed` });
      }
    }
    for (const n of Object.keys(s.expect.states)) if (!known.has(n)) ctx.addIssue({ code: "custom", message: `names campaign "${n}", which the scenario does not seed` });
    for (const c of ids) if (!(c in s.expect.states)) ctx.addIssue({ code: "custom", message: `expect.states must give campaign "${c}"'s final state` });
    // A scenario that runs no job proves nothing, and would pass with every expectation empty.
    if (!s.timeline.some((t) => "hourly_job" in t || "daily_reconcile" in t)) ctx.addIssue({ code: "custom", message: "the timeline runs no job" });
  });

export type MonitorScenario = z.infer<typeof monitorScenarioSchema>;
export type MonitorStep = z.infer<typeof monitorStepSchema>;

/** Parse an untrusted scenario (a YAML file's contents), naming the file in every error. */
export function parseMonitorScenario(raw: unknown, source: string): MonitorScenario {
  const r = monitorScenarioSchema.safeParse(raw);
  if (!r.success) throw new Error(`ads monitor scenario "${source}" is invalid:\n${z.prettifyError(r.error)}`);
  return r.data;
}
