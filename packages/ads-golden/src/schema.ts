/**
 * Ads golden scenario schema (@silvicom/ads-golden; ADS-AGENT-BUILD-WORKFLOW.md §4R, step 7d).
 *
 * A scenario is a timeline a campaign lives through — a person approves, the agent ticks, the owner
 * presses the kill switch, the platform answers an error, the process dies after a write — and what
 * must be true at the end: each campaign's state, its whole `ads_actions` ledger in order, and how
 * many times each vendor was called. It is the Orchestrator's L3 bar ("golden scenarios green") and
 * carries the L2 faults the §4R table names for it.
 *
 * ── WHY THIS PACKAGE HOLDS DATA ONLY ─────────────────────────────────────────────────────────────
 * `@hazmat/golden` imports its engine (`@hazmat/engine`) because that engine is a package. The ads
 * engine is not: the orchestrator, the guard and the ledger live in `apps/api` and read the database
 * through a Supabase client, and a package may not import an app. So the scenarios, this schema and
 * the loader live here; the runner lives beside what it drives (`apps/api/src/testing/adsGolden.ts`,
 * run by `apps/api/src/modules/ads/orchestrator/golden.test.ts`,
 * "every one, through the real orchestrator"). Moving the orchestrator into a package for this would be the tail wagging the dog — it is a service module (docs/ARCHITECTURE.md), and stays one.
 *
 * ── WHY STATE AND EVENT NAMES ARE STRINGS HERE ───────────────────────────────────────────────────
 * The machine's names live in `@silvicom/shared` (`CAMPAIGN_STATES`, `CAMPAIGN_EVENTS`). Restating
 * them as an enum here would be a copy that drifts; depending on shared would make this package wait
 * for its build. The runner checks every name against shared before it runs a step, so a misspelt
 * state fails loudly against the scenario's file name (the same split `@hazmat/golden` uses for the
 * engine's input).
 *
 * ── THE INDEPENDENCE RULE (as in @hazmat/golden) ─────────────────────────────────────────────────
 * `expect` is written from the rules — the machine's table, the guard's fences, the runner's header
 * — never by running the orchestrator and pasting what it did. A scenario whose expectation was
 * copied from the output proves only that the code does what it does.
 */

import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/, "a short lower-case id, e.g. c1");
const cents = z.number().int().nonnegative();

export const campaignSeedSchema = z
  .object({
    id,
    /** The state it starts in (a `CampaignState`). */
    state: z.string().min(1),
    daily_budget_cents: cents.nullable().default(5_000),
    lifetime_cap_cents: cents.nullable().default(50_000),
  })
  .strict();

export const approvalSeedSchema = z
  .object({
    campaign: id,
    daily_budget_cents: cents,
    lifetime_cap_cents: cents,
  })
  .strict();

export const spendSeedSchema = z
  .object({
    campaign: id,
    /** An ISO hour; omitted = the scenario clock's hour at that point. */
    hour: z.string().optional(),
    spend_cents: cents,
  })
  .strict();

/**
 * What one call to a fake vendor answers. A list is consumed one per call; its LAST entry repeats.
 *   ok             · the call succeeds (a create returns the platform's ids)
 *   fail:<code>    · the vendor answers an error (`fail:rate_limited`)
 *   throw          · the call throws (a socket reset): the worker's or guard's catch is what is tested
 *   absent         · the worker is not built (`workers.ts` null) — only meaningful alone
 *   ok+kill        · succeeds, and the owner presses the kill switch WHILE the call is in flight
 */
export const vendorAnswerSchema = z.string().regex(/^(ok|throw|absent|ok\+kill|fail:[a-z0-9_]+)$/);

export const vendorScriptSchema = z
  .object({
    compose: z.array(vendorAnswerSchema).min(1).default(["ok"]),
    create: z.array(vendorAnswerSchema).min(1).default(["ok"]),
    launch: z.array(vendorAnswerSchema).min(1).default(["ok"]),
    pause: z.array(vendorAnswerSchema).min(1).default(["ok"]),
  })
  .strict();

const moveSchema = z.object({ campaign: id, event: z.string().min(1) }).strict();

/** Settings the owner may change mid-run, as overrides of the live limits (`adsWorld.LIVE_SETTINGS`). */
const limitsSchema = z
  .object({
    monthly_cap_cents: cents.nullable().optional(),
    daily_max_cents: cents.nullable().optional(),
    lifetime_max_cents: cents.nullable().optional(),
  })
  .strict();

/** One step of the timeline. Exactly one key per step. */
export const timelineStepSchema = z.union([
  /** One orchestrator tick (every 60 s): enqueue, then run every queued job at once. */
  z.object({ tick: z.number().int().min(1).max(20) }).strict(),
  /** Tick until a tick finds nothing to queue and nothing is waiting (at most 10). */
  z.object({ settle: z.literal(true) }).strict(),
  /** A person's move through the door the screens will use (E-phase): `creatives_approved`, `pause`… */
  z.object({ person: moveSchema }).strict(),
  /** An approver's move — `launch` from paused is an approver's act only. */
  z.object({ approver: moveSchema }).strict(),
  /** What the platform did, mirrored (`platform_paused`, `platform_rejected`…). */
  z.object({ platform: moveSchema }).strict(),
  /** A person approves a launch for these amounts (an `ads_approvals` row). */
  z.object({ approve: approvalSeedSchema }).strict(),
  z.object({ kill_switch: z.boolean() }).strict(),
  /** The owner saves new limits: a new settings version in force from the next read. */
  z.object({ settings: limitsSchema }).strict(),
  z.object({ spend: spendSeedSchema }).strict(),
  /** The Nth write to a table from here on dies as the process dying there would (`adsWorld.crashOnWrite`). */
  z.object({ crash: z.object({ table: z.enum(["ads_campaigns", "ads_actions"]), nth: z.number().int().min(1).default(1) }).strict() }).strict(),
  /** The next tick runs every job it queues TWICE, at once — the queue's at-least-once delivery. */
  z.object({ deliver_twice: z.literal(true) }).strict(),
  z.object({ advance: z.object({ minutes: z.number().optional(), hours: z.number().optional(), days: z.number().optional() }).strict() }).strict(),
]);

export const goldenExpectSchema = z
  .object({
    /** Every campaign's final state. */
    states: z.record(id, z.string()),
    /** `last_error` per campaign; null = cleared. Omitted campaigns are not checked. */
    last_error: z.record(id, z.string().nullable()).default({}),
    /**
     * The campaign's WHOLE `ads_actions` ledger, in the order written. Each line is
     *   "<from> -<event>-> <to> <status>"   a transition (`draft -compose-> composing succeeded`)
     *   "<from> -<event>- refused"          a transition the machine refused
     *   "<kind> <status>"                   any other act (`launch succeeded`, `pause failed`)
     * Omitted campaigns are not checked.
     */
    ledger: z.record(id, z.array(z.string())).default({}),
    /**
     * Calls to each fake vendor across the run. `creates` counts DISTINCT objects the platform
     * made — the §4R bar "0 duplicate vendor creates" — where `create` counts calls (a retried,
     * idempotent create is two calls and one object).
     */
    vendor: z
      .object({
        compose: z.number().int().optional(),
        create: z.number().int().optional(),
        creates: z.number().int().optional(),
        launch: z.number().int().optional(),
        pause: z.number().int().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export const goldenScenarioSchema = z
  .object({
    name: z.string().min(1),
    /** What the scenario proves, and which rule the expectation was written from. */
    why: z.string().min(1),
    /** The §4R Orchestrator rows it covers (`kill_switch`, `crash`, `approval_missing`…). */
    covers: z.array(z.string().min(1)).min(1),
    /** Who wrote the expectation (the independence rule above). */
    verifiedBy: z.string().min(1),
    /** Settings at the start: the live limits, or never saved (`unset` refuses every launch). */
    settings: z.enum(["live", "unset"]).default("live"),
    kill_switch: z.boolean().default(false),
    /** The ad account's own limit as the platform reports it (null = unreadable). */
    account_limit_cents: cents.nullable().default(300_000),
    campaigns: z.array(campaignSeedSchema).min(1),
    approvals: z.array(approvalSeedSchema).default([]),
    spend: z.array(spendSeedSchema).default([]),
    vendor: vendorScriptSchema.default({ compose: ["ok"], create: ["ok"], launch: ["ok"], pause: ["ok"] }),
    timeline: z.array(timelineStepSchema).min(1),
    expect: goldenExpectSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.campaigns.map((c) => c.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "campaign ids must be unique" });
    const known = new Set(ids);
    const named = [
      ...s.approvals.map((a) => a.campaign),
      ...s.spend.map((r) => r.campaign),
      ...Object.keys(s.expect.states),
      ...Object.keys(s.expect.ledger),
      ...Object.keys(s.expect.last_error),
      ...s.timeline.flatMap((t) => {
        const step = t as Record<string, { campaign?: string }>;
        return Object.values(step).flatMap((v) => (v && typeof v === "object" && typeof v.campaign === "string" ? [v.campaign] : []));
      }),
    ];
    for (const n of named) if (!known.has(n)) ctx.addIssue({ code: "custom", message: `names campaign "${n}", which the scenario does not seed` });
    for (const c of ids) if (!(c in s.expect.states)) ctx.addIssue({ code: "custom", message: `expect.states must give campaign "${c}"'s final state` });
    for (const [worker, script] of Object.entries(s.vendor)) {
      if (script.includes("absent") && script.length > 1) ctx.addIssue({ code: "custom", message: `vendor.${worker}: "absent" means the worker is not built, so it stands alone` });
    }
  });

export type GoldenScenario = z.infer<typeof goldenScenarioSchema>;
export type TimelineStep = z.infer<typeof timelineStepSchema>;
export type VendorAnswer = z.infer<typeof vendorAnswerSchema>;
export type VendorScript = z.infer<typeof vendorScriptSchema>;

/** Parse an untrusted scenario (a YAML file's contents), naming the file in every error. */
export function parseScenario(raw: unknown, source: string): GoldenScenario {
  const r = goldenScenarioSchema.safeParse(raw);
  if (!r.success) throw new Error(`ads golden scenario "${source}" is invalid:\n${z.prettifyError(r.error)}`);
  return r.data;
}
