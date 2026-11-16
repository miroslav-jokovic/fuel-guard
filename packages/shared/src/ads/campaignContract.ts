import { z } from "zod";
import { MAX_PICTURES_PER_CREATIVE, asGoodCount, type AdPairing, type AdPairings, type AdPicture } from "./adPairings.js";
import type { AdCandidates } from "./copyCandidates.js";
import type { PlatformText } from "./platformText.js";
import type { AdNameLanguage } from "./naming.js";
import { recordId } from "../recordId.js";
import type { AdBrief, CampaignState, CreativeState } from "./contracts.js";
import { CAMPAIGN_EVENTS, type CampaignEvent } from "./campaignMachine.js";

/**
 * The campaign doors' wire contracts (ADS-AGENT-BUILD-WORKFLOW Track S, S1b): what the campaign flow (E3)
 * sends to create a campaign and reads back for the list and the review screen. The web and the API parse
 * the same schemas.
 *
 * Industry-neutral (D-AD17): a campaign is made from a BRIEF, named by its source and ref; the source
 * ("recruiting_opening") and the ref (an opening id) are recruiting's words, passed through, never read
 * here. Which moves a campaign offers is not in the view: the screens ask `campaignEventsFrom(state)` (the
 * machine), so a button list can never disagree with what the door would allow.
 */

export const adsCampaignCreateSchema = z.object({
  /**
   * Chosen by the browser once per "Create" (a fresh uuid per form). A second delivery of the same click —
   * a double press, a retried request — finds the row the first one made instead of making a second
   * campaign for the same opening.
   */
  id: recordId(),
  brief_source: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  brief_ref: z.string().trim().min(1).max(200),
  connection_id: recordId(),
  /** Q-AD28: the kit every creative of this campaign is made with. */
  brand_kit_id: recordId(),
  /** Defaults to the brief's subject. */
  name: z.string().trim().min(1).max(200).nullable().optional(),
});
export type AdsCampaignCreate = z.infer<typeof adsCampaignCreateSchema>;

/** Why a create was refused, each a thing a person can fix on another screen. */
export const ADS_CAMPAIGN_CREATE_REFUSALS = [
  "brief_source_unknown", "brief_unavailable", "settings_not_saved", "connection_unusable", "brand_kit_unusable",
  "id_taken",
] as const;
export type AdsCampaignCreateRefusal = (typeof ADS_CAMPAIGN_CREATE_REFUSALS)[number];

export interface AdsCampaignSummary {
  id: string;
  name: string;
  state: CampaignState;
  state_changed_at: string;
  brief_source: string;
  brief_ref: string;
  connection_id: string;
  brand_kit_id: string | null;
  daily_budget_cents: number | null;
  lifetime_cap_cents: number | null;
  last_error: string | null;
  created_at: string;
}

/** One format of a creative's image, as compose stored it (0537 `ads_creatives.assets`). */
export interface AdsCreativeAsset {
  format: string;
  language: string;
  sha256: string;
  path: string;
  width: number;
  height: number;
  /** A short-lived link to the finished image for the review screen; null when one could not be made. Never stored. */
  url: string | null;
}

/** A pairing as the review screen reads it: its one kept image with a short-lived link (null when none could be made). */
export type AdPairingView = Omit<AdPairing, "preview"> & { preview: (NonNullable<AdPairing["preview"]> & { url: string | null }) | null };
export type AdPairingsView = Omit<AdPairings, "ranked"> & { ranked: AdPairingView[] };

export interface AdRival {
  /** Its place in the ranking, from 1. */
  rank: number;
  picture: number;
  /** The words, by their index in `candidates.ranked`. */
  words: number;
  /** The four scores added, of 20; null when the judge did not score it. */
  total: number | null;
  /** This pairing is the ad. */
  chosen: boolean;
  /**
   * Scored within the judge's own movement of the best (`PAIRING_TIE_MARGIN`): the screen says "as good", never
   * "second". False for everything when nothing was judged.
   */
  asGood: boolean;
  url: string | null;
}

/**
 * What the review screen shows of the pictures and words an ad was chosen from (V3 "show few"): every pairing in
 * rank order with whether it is the ad and whether it is as good as the best, and the pictures that were made and
 * not used, each with why. One function, so the screen states nothing the ranking did not.
 */
export function adRivals(pairings: AdPairingsView): { judged: boolean; rivals: AdRival[]; unused: Array<Pick<AdPicture, "picture"> & { reason: string }> } {
  const level = asGoodCount(pairings.ranked);
  return {
    judged: pairings.judge !== null,
    rivals: pairings.ranked.map((r, i) => ({ rank: i + 1, picture: r.picture, words: r.words, total: r.total, chosen: i === pairings.chosen, asGood: i < level, url: r.preview?.url ?? null })),
    unused: pairings.pictures.flatMap((p) => (p.dropped === null ? [] : [{ picture: p.picture, reason: p.dropped }])),
  };
}

export interface AdsCreativeView {
  id: string;
  preset_version_id: string;
  brand_kit_version_id: string | null;
  supersedes_id: string | null;
  state: CreativeState;
  /**
   * What the platform does with it, apart from review: `retired` (CQ9b, tired and paused), `active` (a replacement
   * turned on, Q-AD68), `activate_failed`; null when nothing was said. `isReplacement` reads it.
   */
  platform_status: string | null;
  /** The copy per language and slot, as the copywriter wrote it and the checks read it. */
  copy: Record<string, unknown> | null;
  assets: AdsCreativeAsset[];
  /** D-AD12's three checks (copy, visual, render), each with its verdict and reasons. */
  checks: Record<string, unknown> | null;
  /** Every copy the Copywriter offered, ranked by the craft judge, and which became `copy` (CQ4, 0579); null before CQ4. */
  candidates: AdCandidates | null;
  /**
   * The pictures this ad was chosen from and every picture-and-words pairing, ranked by the finished-ad judge (V3,
   * 0619); null for an ad made from one picture — every ad before V3, and one built from a person's choice.
   */
  pairings: AdPairingsView | null;
  /**
   * The two texts Meta is handed beside the image, per language — primary text above it, headline under it — as the
   * publisher would send them (`platformText`). A language is null when its copy lacks one of them; the whole is
   * null when the ad's preset names no slots for them, which is an ad the publisher refuses.
   */
  platform_text: Partial<Record<AdNameLanguage, PlatformText | null>> | null;
  regenerations: number;
  last_error: string | null;
  created_at: string;
}

export interface AdsCampaignView extends AdsCampaignSummary {
  /** Frozen at creation (AX031): the only facts the copy may claim. */
  brief_snapshot: AdBrief;
  settings_version_id: string;
  /** Oldest first; a superseded creative stays, its successor names it. */
  creatives: AdsCreativeView[];
}

// ── S1c: the moves a person makes on a campaign ──────────────────────────────────────────────────
/**
 * The machine's events a person presses on the campaign page, minus the ones with their own door:
 *   · `kill` — the kill switch's own event, applied to every delivering campaign by `killSwitch.ts`.
 * `creatives_approved` IS here since S1d, behind one more condition the door checks: at least one creative
 * a person approved (each decision is its own door, `…/creatives/:id/decision`).
 * `launch` is not here either: it spends, so it is the approver's door below. Whether an event is
 * legal from the campaign's state, and whether a person may cause it, is still the machine's to say.
 */
/**
 * `plan_approved` is excluded too (V2): it must name the plan version the person approved, which the general
 * door has no field for, so it has its own door with the plan store (`POST …/plan/approval`, `plan/planDoors.ts`).
 */
export const ADS_PERSON_DOOR_EXCLUDED: readonly CampaignEvent[] = ["kill", "launch", "plan_approved"];
export const adsCampaignMoveSchema = z.object({
  event: z.enum(CAMPAIGN_EVENTS),
  reason: z.string().trim().min(1).max(500).nullable().optional(),
});
export type AdsCampaignMove = z.infer<typeof adsCampaignMoveSchema>;

/** Launch: the amounts an approver launches at. A standing approval must cover them (`ads_approvals`). */
export const adsCampaignLaunchSchema = z.object({
  daily_budget_cents: z.number().int().positive(),
  lifetime_cap_cents: z.number().int().positive(),
});
export type AdsCampaignLaunch = z.infer<typeof adsCampaignLaunchSchema>;

// ── S1d: a person's decision on one creative ────────────────────────────────────────────────────
export const adsCreativeDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  /** Required to reject — the record of why an ad was turned down — and optional to approve. */
  reason: z.string().trim().min(1).max(1000).nullable().optional(),
}).refine((d) => d.decision === "approve" || Boolean(d.reason), { message: "Say why the ad is rejected.", path: ["reason"] });
export type AdsCreativeDecision = z.infer<typeof adsCreativeDecisionSchema>;

// ── Q-ADL7: a person chooses an ad's words ──────────────────────────────────────────────────────
const copySlots = z.record(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), z.string().trim().min(1).max(500));
/**
 * The words a person settles on for one creative: every slot in both languages, and which offered copy it started
 * from (an index into the creative's ranked candidates; null = the copy the ad already has). The door checks the
 * words against the brief, the preset's slots and limits and the overlay before anything is written
 * (`campaigns/copyChoice.ts`); the schema only says what a well-formed ask is.
 */
export const adsCopyChoiceSchema = z.object({
  from_candidate: z.number().int().min(0).max(4).nullable(),
  copy: z.object({ en: copySlots, es: copySlots }).strict(),
  /**
   * Which of the ad's pictures the words go on (V3, `ads_copy_choices.picture`, 0619): one of the pictures the ad
   * was chosen from, by its number. Absent or null = the picture the ad has. The door refuses a picture the ad
   * never made, or one that was dropped.
   */
  picture: z.number().int().min(1).max(MAX_PICTURES_PER_CREATIVE).nullable().optional(),
}).strict();
export type AdsCopyChoice = z.infer<typeof adsCopyChoiceSchema>;
