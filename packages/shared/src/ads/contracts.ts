import { z } from "zod";
import { recordId } from "../recordId.js";

/**
 * The ads module's contracts (ADS-AGENT-BUILD-WORKFLOW.md A3; D-AD16, D-AD17).
 *
 * Industry-neutral on purpose (D-AD17): nothing here knows what a driver is. What an ad may say
 * arrives as an `AdBrief` from an `AdBriefSource` (recruiting implements one for an opening); every
 * platform lead leaves through a `LeadSink`. A second brief source — a fuel-card offer, a customer
 * campaign — plugs into the same module without touching it.
 *
 * The state and kind lists below mirror the CHECK constraints of migration 0537. The two copies are
 * held together by `adsSchemaParity.test.ts` in apps/api (this package is also built for React Native
 * and cannot read a file), which fails when either side moves alone.
 */

// ── the lists the database also checks (0537) ───────────────────────────────────────────────────
export const AD_PROVIDERS = ["meta", "tiktok", "x", "higgsfield", "simulator"] as const;
export type AdProvider = (typeof AD_PROVIDERS)[number];

/** The providers an ad runs on (Higgsfield renders; it does not publish). */
export const AD_PLATFORMS = ["meta", "tiktok", "x", "simulator"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const CAMPAIGN_STATES = [
  "draft", "composing", "review", "approved", "creating", "paused",
  "launching", "live", "pausing", "archived", "failed",
] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const CREATIVE_STATES = [
  "generating", "checking", "check_failed", "ready", "approved", "rejected", "live", "paused", "archived",
] as const;
export type CreativeState = (typeof CREATIVE_STATES)[number];

export const APPROVAL_KINDS = [
  "approve_creative", "reject_creative", "launch", "raise_budget", "change_area", "withdraw",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const ACTION_KINDS = [
  "transition", "create_paused", "launch", "pause", "lower_budget", "raise_budget", "change_area",
  "archive", "kill", "external_change", "rules_sync", "connection_test", "reconcile",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const OUTCOME_STAGES = ["contacted", "qualified", "applied", "hired", "lost"] as const;
export type OutcomeStage = (typeof OUTCOME_STAGES)[number];

/**
 * The five workers that ask a model (ADS-AGENT-PLAN §2c's worker table: "five of the eleven workers
 * use a model"). Each has its own per-org switch, off until an admin turns it on (D-RA9), and is the
 * `agent` an `ad_generations` row names. Lead intake's email extraction is not here: under D-AD17
 * it is recruiting's, and recruiting keeps its own provenance (`recruiting_ai_outputs`, step D0).
 * 0537 checks `ad_generations.agent` by shape (`^[a-z][a-z_]{1,40}$`), not by list, so a worker added
 * here needs no migration — every name below fits that shape.
 */
export const AD_AI_AGENTS = ["copywriter", "art_director", "renderer", "checker", "analyst"] as const;
export type AdAiAgent = (typeof AD_AI_AGENTS)[number];

// ── the brief: the only source of an ad's facts (D-AD1) ─────────────────────────────────────────
/**
 * A fact the copy may state. `money` is in cents with what it is per; `quantity` is a number with a
 * unit; `term` is a phrase from the listed vocabulary (`adClaims.ts`). The claim checker accepts a
 * figure in the copy only when a claim here matches it, so this list IS the boundary of what an ad
 * can promise.
 */
export const AD_MONEY_PER = ["mile", "week", "year", "hour", "day", "load"] as const;
export const AD_QUANTITY_UNITS = ["day", "week", "month", "year", "mile", "state", "percent", "hour", "load", "age"] as const;
export const adClaimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), cents: z.number().int().positive(), per: z.enum(AD_MONEY_PER).nullable() }),
  z.object({ kind: z.literal("quantity"), value: z.number().positive(), unit: z.enum(AD_QUANTITY_UNITS) }),
  z.object({ kind: z.literal("term"), term: z.string().trim().min(2).max(60) }),
]);
export type AdClaim = z.infer<typeof adClaimSchema>;

/**
 * Where an ad runs: a point, a radius and the reason written by a person. Never a ZIP list (Illinois
 * HB 3773 treats ZIP as a proxy for protected classes) and never under 15 miles (Meta's employment
 * category floor). There is no age, gender or ZIP field to fill — the builder cannot target by them.
 */
export const adAreaSchema = z.object({
  label: z.string().trim().min(2).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_miles: z.number().int().min(15).max(500),
  reason: z.string().trim().min(5).max(500),
});
export type AdArea = z.infer<typeof adAreaSchema>;

export const adBriefSchema = z.object({
  source: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  ref: z.string().trim().min(1).max(200),
  /** What is advertised, in plain words ("Class A regional driver"), for the copy's subject. */
  subject: z.string().trim().min(2).max(120),
  claims: z.array(adClaimSchema).min(1).max(40),
  area: adAreaSchema,
  /** Keys of the form questions the platform form may ask (the lead-form builders own the wording). */
  form_questions: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/)).max(10),
  /** Where "Apply" lands when the platform form is not used. */
  landing_url: z.url({ protocol: /^https$/ }).nullable(),
});
export type AdBrief = z.infer<typeof adBriefSchema>;

/** D-AD17: recruiting implements this for an opening; ads never reads the opening itself. */
export interface AdBriefSource {
  readonly source: string;
  /** The brief for one ref, or null when the ref no longer names a publishable thing. */
  briefFor(orgId: string, ref: string): Promise<AdBrief | null>;
}

// ── leads leave through a sink (D-AD17) ─────────────────────────────────────────────────────────
/** What a platform handed us for one lead. `answers` are the form's raw answers, keyed by question. */
export const platformLeadSchema = z.object({
  provider: z.enum(AD_PLATFORMS),
  platform_lead_ref: z.string().trim().min(1).max(200),
  campaign_id: recordId().nullable(),
  brief_source: z.string().nullable(),
  brief_ref: z.string().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  answers: z.record(z.string(), z.string().max(2000)),
  raw: z.unknown(),
});
export type PlatformLead = z.infer<typeof platformLeadSchema>;

/** A stage a lead reached, handed back for the outcome feed (D-AD14). `event_ref` is the sink's row id. */
export interface LeadStageEvent {
  provider: AdPlatform;
  platform_lead_ref: string;
  stage: OutcomeStage;
  event_ref: string;
}

export interface LeadSink {
  /** Idempotent by (provider, platform_lead_ref): the same lead twice is stored once. */
  accept(orgId: string, lead: PlatformLead): Promise<{ stored: "new" | "duplicate"; ref: string }>;
}
