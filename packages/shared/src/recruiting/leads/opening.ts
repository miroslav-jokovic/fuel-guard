import { z } from "zod";
import { recordId } from "../../recordId.js";
import { AD_MONEY_PER, adAreaSchema } from "../../ads/contracts.js";
import { PROMISE_TERMS, checkClaims, promiseTermOf, quantitiesIn } from "../../ads/adClaims.js";
import type { AdClaim } from "../../ads/contracts.js";

/**
 * An opening: the one thing an ad may advertise (RECRUITER-AUTOMATION-PLAN.md 1.2, D-RA11; workflow G4).
 * Stored as `recruiting_opening_versions` (0553): the area in its own columns, everything else in `facts`,
 * whose shape is this file.
 *
 * The area IS the ads module's `adAreaSchema` — a point, 15–500 miles and the reason a person wrote —
 * imported, not restated: the opening's area is exactly what the ad will target, and two copies of the
 * bounds would drift (CLAUDE.md, "Deriving beats restating"). There is no ZIP field to fill.
 *
 * Pay uses the ads claims' units (`AD_MONEY_PER`), in cents, for the same reason: the claim checker
 * (D-AD1) accepts a figure in the copy only when the brief holds it, and the brief is built from this.
 */

export const OPENING_EQUIPMENT = ["dry_van", "reefer", "flatbed", "tanker", "intermodal"] as const;
/** How the work runs — subject matter for the copy, never a promise (CQ2, D-AD20). */
export const OPENING_SCHEDULES = ["otr", "regional", "local"] as const;
/** The two bonuses an ad may state an amount for; each is also a `PROMISE_TERMS` key the claim checker knows. */
export const OPENING_BONUS_KINDS = ["sign-on bonus", "referral bonus"] as const;
/**
 * What an opening may tick as a benefit or a feature of the job: EVERY `PROMISE_TERMS` key except home time (its
 * own field) and the bonuses (an amount, above) — derived, so a term the claim checker learns is a box the editor
 * grows, and no second list can drift (CLAUDE.md "Deriving beats restating"). Each ticked key becomes a `term`
 * claim of the brief, which is the ONLY way copy may say "401k" or "no-touch freight" (D-AD1).
 */
export const OPENING_BENEFIT_TERMS = Object.keys(PROMISE_TERMS).filter(
  (k) => !k.startsWith("home ") && !(OPENING_BONUS_KINDS as readonly string[]).includes(k),
) as [string, ...string[]];
export const OPENING_STATUSES = ["open", "paused", "filled", "closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

/** What a picker reads from `GET /recruitment/openings`: `current` is the newest version, null until one is saved. */
export interface OpeningListItem {
  id: string;
  status: OpeningStatus;
  current: { title: string } | null;
}

/**
 * One answer of `GET /recruitment/place-suggest` (Q-AD44 (a)): a place a person can pick as an opening's area
 * point. `lat`/`lng` become `adAreaSchema`'s `latitude`/`longitude`; the label is a starting `area.label`.
 */
export interface PlaceSuggestion {
  label: string;
  lat: number;
  lng: number;
}

export const openingFactsSchema = z
  .object({
    pay: z
      .object({
        per: z.enum(AD_MONEY_PER),
        min_cents: z.number().int().positive(),
        max_cents: z.number().int().positive().nullable(),
      })
      .refine((p) => p.max_cents === null || p.max_cents >= p.min_cents, {
        message: "The top of the pay range is below its bottom.",
        path: ["max_cents"],
      }),
    home_time: z.string().trim().min(2).max(120),
    equipment: z.array(z.enum(OPENING_EQUIPMENT)).min(1).max(OPENING_EQUIPMENT.length),
    lanes: z.string().trim().min(2).max(200).nullable(),
    start_date: z.iso.date().nullable(),
    // ── CQ2 (D-AD20, Q-AD54 (b)): the job, not only its figures. Each defaults so a version saved before CQ2 parses.
    /** Ticked `PROMISE_TERMS` keys; each is a `term` claim the copy may state. */
    benefits: z.array(z.enum(OPENING_BENEFIT_TERMS)).max(OPENING_BENEFIT_TERMS.length).default([]),
    /** A bonus with its amount: a `money` claim (no basis) AND its `term` claim. Null = no bonus is advertised. */
    bonus: z.object({ kind: z.enum(OPENING_BONUS_KINDS), cents: z.number().int().positive() }).nullable().default(null),
    schedule: z.enum(OPENING_SCHEDULES).nullable().default(null),
    /**
     * The carrier's one line in its own words ("Family-run since the eighties; dispatch answers the phone"). Subject
     * matter, not a claim: a figure or a listed promise in it must be one of THIS opening's (checked below), so the
     * line cannot smuggle a "$5,000 bonus" past the fields that make it true.
     */
    in_our_words: z.string().trim().min(2).max(140).nullable().default(null),
  })
  .strict()
  .superRefine((f, ctx) => {
    if (f.in_our_words === null) return;
    const check = checkClaims(f.in_our_words, { claims: factClaims(f) });
    for (const finding of check.findings) {
      ctx.addIssue({ code: "custom", path: ["in_our_words"], message: inOurWordsSentence(finding.kind, finding.text) });
    }
  });
export type OpeningFacts = z.infer<typeof openingFactsSchema>;

/**
 * The claims an opening's OWN facts make — pay, the bonus, the ticked benefits, and home time when the text typed IS
 * a listed term ("Home weekly" → `home weekly`; anything else is subject matter, never a term by guessing) — as
 * `openingBrief` states them. Pure; the profile's age and years floors are added by `openingBrief`, which has the
 * profile. Shared by the brief and by the `in_our_words` check above, so the line is held to the same figures and
 * promises the ad will be.
 */
export function factClaims(f: Pick<OpeningFacts, "pay" | "bonus" | "benefits" | "home_time" | "lanes">): AdClaim[] {
  const claims: AdClaim[] = [{ kind: "money", cents: f.pay.min_cents, per: f.pay.per }];
  if (f.pay.max_cents !== null && f.pay.max_cents !== f.pay.min_cents) claims.push({ kind: "money", cents: f.pay.max_cents, per: f.pay.per });
  const home = promiseTermOf(f.home_time);
  if (home) claims.push({ kind: "term", term: home });
  // The figures a person typed into home time and lanes ("Out 2 weeks, home 4 days", "within 500 miles") are facts
  // a person saved on the opening, so the copy may repeat them exactly — and nothing it did not type (CQ2).
  else for (const q of quantitiesIn(f.home_time)) claims.push({ kind: "quantity", value: q.value, unit: q.unit });
  if (f.lanes) for (const q of quantitiesIn(f.lanes)) claims.push({ kind: "quantity", value: q.value, unit: q.unit });
  if (f.bonus) {
    claims.push({ kind: "money", cents: f.bonus.cents, per: null });
    claims.push({ kind: "term", term: f.bonus.kind });
  }
  for (const term of f.benefits ?? []) claims.push({ kind: "term", term });
  return claims;
}

/** The editor's sentence for a finding in the carrier's own line — the rule it broke, in office words. */
export function inOurWordsSentence(kind: string, text: string): string {
  switch (kind) {
    case "money_not_in_brief": return `"${text}" is a figure the pay and bonus fields do not hold; put it there or leave it out.`;
    case "term_not_in_brief": return `"${text}" is a promise; tick it under benefits or leave it out.`;
    case "forbidden_wording": return `"${text}" may not appear in an employment ad.`;
    case "foreign_unit": return `"${text}" is not a unit a US driver uses.`;
    default: return `"${text}" is a number or promise the opening's fields do not hold.`;
  }
}

/**
 * One opening as `GET /recruitment/openings` answers it (`listOpenings`, apps/api `recruiting/leads/hiringSetup.ts`):
 * the parent row and its newest version, the area in its 0553 columns. The Openings editor reads it; the
 * campaign picker needs only `OpeningListItem`'s part of it.
 */
export interface OpeningVersionView {
  id: string;
  version: number;
  profile_version_id: string;
  title: string;
  facts: OpeningFacts;
  headcount: number | null;
  area_label: string;
  area_latitude: number;
  area_longitude: number;
  area_radius_miles: number;
  area_reason: string;
  created_by_name: string;
  created_at: string;
}
export interface OpeningView extends OpeningListItem {
  created_at: string;
  current: OpeningVersionView | null;
  /** Who owns this opening's leads (0574, Q-AD50 (a)); null = every recruitment manager is rung. */
  recruiter_id: string | null;
}

/** `POST /recruitment/openings/:id/recruiter` (LQ2b): name the owner, or null to hand the opening back to everyone. */
export const openingRecruiterSchema = z.object({ recruiter_id: recordId().nullable() });
export type OpeningRecruiterSave = z.infer<typeof openingRecruiterSchema>;

/** One person who may own an opening's leads: holds `recruitment: manage` today (`GET /recruitment/recruiters`). */
export interface RecruiterOption {
  user_id: string;
  label: string;
}

export const openingSaveSchema = z.object({
  /** Null creates the opening; an id saves its next version (`save_opening_version`, 0554). */
  opening_id: recordId().nullable(),
  profile_version_id: recordId(),
  title: z.string().trim().min(2).max(120),
  facts: openingFactsSchema,
  headcount: z.number().int().min(1).max(1000).nullable(),
  area: adAreaSchema,
});
export type OpeningSave = z.infer<typeof openingSaveSchema>;

/** The `p_version` argument of `save_opening_version` (0554): the area flattened into its columns. */
export function openingVersionRow(save: OpeningSave): Record<string, unknown> {
  return {
    profile_version_id: save.profile_version_id,
    title: save.title,
    facts: save.facts,
    headcount: save.headcount,
    area_label: save.area.label,
    area_latitude: save.area.latitude,
    area_longitude: save.area.longitude,
    area_radius_miles: save.area.radius_miles,
    area_reason: save.area.reason,
  };
}
