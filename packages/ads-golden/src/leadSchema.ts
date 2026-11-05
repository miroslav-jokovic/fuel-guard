/**
 * Lead intake golden scenario schema (@silvicom/ads-golden; ADS-AGENT-BUILD-WORKFLOW.md §4R, Lead intake's L3 bar:
 * "0 lost, 0 duplicated leads over the scenario set; injection text never reaches an action").
 *
 * A scenario is a timeline of leads and of what happened to their deliveries across the two roads, the leadgen
 * webhook and the hourly backfill, ending in a count. `expect.stored` and `expect.dropped` must between them name
 * EVERY lead the scenario submits, so a scenario cannot leave a lead unaccounted for and still pass.
 *
 * ── WHAT THESE PROVE, AND WHAT THEY DO NOT ───────────────────────────────────────────────────────
 * They prove the ROADS: the webhook, the queue's dedupe, the fetch, the backfill and its catch-up, the real sink
 * and the real verdicts. The one thing imitated is `ingest_lead`'s SQL, by a map keyed as its unique index is
 * (`adsLeadGolden.ts`). So "stored once" here means each road asked for the same key and retried correctly. That
 * the database then keeps one row, and who else it may be, is `supabase/tests/recruiting-lead-functions.test.mjs`,
 * which runs the real function on PGlite. Neither is enough alone.
 *
 * The header of `schema.ts` holds for this file too: data only, the runner beside what it drives, and THE
 * INDEPENDENCE RULE. `expect` is written from the road's headers (`leadgenWebhook.ts`, `leadFetch.ts`, `backfill.ts`,
 * `leadSink.ts`), never pasted from a run.
 */

import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]*$/, "a short lower-case id, e.g. l1");
const leads = z.array(id).min(1);
const road = z.enum(["webhook", "backfill"]);
const times = z.number().int().min(1).max(10);

/** One step of the timeline. Exactly one key per step. */
export const leadStepSchema = z.union([
  /** A person sends the form. `other` is a form no campaign of ours holds. */
  z.object({
    submit: z.object({
      lead: id,
      form: z.enum(["en", "es", "other"]).default("en"),
      answers: z.record(z.string(), z.string()).default({ full_name: "Ray Driver", phone_number: "+13125550100" }),
    }).strict(),
  }).strict(),
  /** One signed delivery naming these leads, through the real receiver. Leaving a lead out is a webhook lost. */
  z.object({ webhook: leads }).strict(),
  /** The same delivery, signed with the wrong secret. */
  z.object({ forged_webhook: leads }).strict(),
  /** The worker runs every queued `ads_lead_fetch` once. A job that throws stays queued. */
  z.object({ jobs: z.literal(true) }).strict(),
  /** One hourly `ads_leads_backfill`, reaching back as its handler does. */
  z.object({ backfill: z.literal(true) }).strict(),
  /** The next N reads of one lead by id, or of a form's list, are refused by Meta. */
  z.object({ meta_refuses: z.object({ reads: times.optional(), listings: times.optional() }).strict() }).strict(),
  /** The next N stores fail before anything is written. */
  z.object({ store_fails: times }).strict(),
  /** The next N stores commit, and the answer is lost on its way back (a crash between the two). */
  z.object({ store_answer_lost: times }).strict(),
  z.object({ advance: z.object({ minutes: z.number().optional(), hours: z.number().optional(), days: z.number().optional() }).strict() }).strict(),
]);

export const leadExpectSchema = z
  .object({
    /** Every lead stored, and the road that stored it. Each must be stored exactly once. */
    stored: z.record(id, road),
    /** Leads that are rightly not ours to store: only a lead on the `other` form. */
    dropped: z.array(id).default([]),
    /** Deliveries answered 200, and refused 401. */
    accepted: z.number().int().nonnegative().default(0),
    refused: z.number().int().nonnegative().default(0),
    /** EVERY failure: `jobs <n>: <lead> <reason>` or `backfill <n>: <lead or form> <reason>`. */
    failures: z.array(z.string()).default([]),
    /** The leads whose `lead_new` rang. Omitted = every lead stored. A lost ring stays lost (`leadNotify.ts`). */
    rung: z.array(id).optional(),
    /** Leads with an `ads_lead_fetch` job still queued at the end. */
    waiting: z.array(id).default([]),
    /** What must have been kept as typed, by lead. */
    answers: z.record(id, z.record(z.string(), z.string())).default({}),
    /** Verdicts to check, by lead and requirement. */
    verdicts: z.record(id, z.record(z.string(), z.string())).default({}),
    /** The contact fields the store was handed, by lead. */
    contact: z.record(id, z.object({ phone_e164: z.string().nullable() }).strict()).default({}),
  })
  .strict();

export const leadScenarioSchema = z
  .object({
    name: z.string().min(1),
    /** What the scenario proves, and which rule the expectation was written from. */
    why: z.string().min(1),
    /** The §4R Lead intake rows it covers (`webhook_lost`, `injection`…). */
    covers: z.array(z.string().min(1)).min(1),
    /** Who wrote the expectation (the independence rule). */
    verifiedBy: z.string().min(1),
    timeline: z.array(leadStepSchema).min(1),
    expect: leadExpectSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    const forms = new Map<string, string>();
    for (const t of s.timeline) {
      if (!("submit" in t)) continue;
      if (forms.has(t.submit.lead)) ctx.addIssue({ code: "custom", message: `lead "${t.submit.lead}" is submitted twice` });
      forms.set(t.submit.lead, t.submit.form);
    }
    const stored = Object.keys(s.expect.stored);
    const named = [
      ...stored, ...s.expect.dropped, ...s.expect.waiting, ...(s.expect.rung ?? []), ...Object.keys(s.expect.answers), ...Object.keys(s.expect.verdicts), ...Object.keys(s.expect.contact),
      ...s.timeline.flatMap((t) => ("webhook" in t ? t.webhook : "forged_webhook" in t ? t.forged_webhook : [])),
    ];
    for (const n of named) if (!forms.has(n)) ctx.addIssue({ code: "custom", message: `names lead "${n}", which the scenario does not submit` });
    // §4R's "0 lost": a lead the scenario submits is stored, or rightly not ours. There is no third answer.
    for (const [lead, form] of forms) {
      const ours = stored.includes(lead);
      const dropped = s.expect.dropped.includes(lead);
      if (ours === dropped) ctx.addIssue({ code: "custom", message: `lead "${lead}" must be in exactly one of expect.stored and expect.dropped` });
      if (dropped && form !== "other") ctx.addIssue({ code: "custom", message: `lead "${lead}" is on a form of ours, so dropping it is losing it` });
      if (ours && form === "other") ctx.addIssue({ code: "custom", message: `lead "${lead}" is on a form no campaign holds, so it cannot be stored` });
    }
  });

export type LeadScenario = z.infer<typeof leadScenarioSchema>;
export type LeadStep = z.infer<typeof leadStepSchema>;

/** Parse an untrusted scenario (a YAML file's contents), naming the file in every error. */
export function parseLeadScenario(raw: unknown, source: string): LeadScenario {
  const r = leadScenarioSchema.safeParse(raw);
  if (!r.success) throw new Error(`ads lead scenario "${source}" is invalid:\n${z.prettifyError(r.error)}`);
  return r.data;
}
