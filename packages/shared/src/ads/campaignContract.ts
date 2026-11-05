import { z } from "zod";
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
  sha256: string;
  path: string;
  width: number;
  height: number;
}

export interface AdsCreativeView {
  id: string;
  preset_version_id: string;
  brand_kit_version_id: string | null;
  supersedes_id: string | null;
  state: CreativeState;
  /** The copy per language and slot, as the copywriter wrote it and the checks read it. */
  copy: Record<string, unknown> | null;
  assets: AdsCreativeAsset[];
  /** D-AD12's three checks (copy, visual, render), each with its verdict and reasons. */
  checks: Record<string, unknown> | null;
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
export const ADS_PERSON_DOOR_EXCLUDED: readonly CampaignEvent[] = ["kill", "launch"];
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
