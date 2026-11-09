import { z } from "zod";
import { recordId } from "../../recordId.js";
import { AD_MONEY_PER, adAreaSchema } from "../../ads/contracts.js";

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
  })
  .strict();
export type OpeningFacts = z.infer<typeof openingFactsSchema>;

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
