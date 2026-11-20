import { ADS_AUTHORITY, type AdsAct } from "./adsPolicy.js";
import type { CampaignEvent } from "./campaignMachine.js";
import { CAMPAIGN_LIST_LIMIT } from "./campaignContract.js";
import { modesOf, type AdsSettings } from "./settingsContract.js";

/**
 * V5 · a mode per step (ADS-PLATFORM-V2-PLAN §4 V5; Q-APX21 (a), ruled by the owner 2026-11-19). Pure.
 *
 * ── WHAT A MODE IS, AND WHERE IT IS REAL ──────────────────────────────────────────────────────────────
 *   manual     a person does the step; no agent prepares it
 *   assisted   an agent prepares it; a person decides
 *   autopilot  an agent does it with no person (Q-APX1's levels)
 * A step offers a second mode only where one is real in the code (Q-APX21's reading of the six steps, every claim at
 * its call site). Approving a plan has no Manual: a person writing a plan from nothing is not built and Q-APX6 made
 * the Strategist's plan mandatory. "Move budget between ads" is not a step at all: Meta's Ad object has no budget
 * (read 2026-11-19) and each of our campaigns is one ad set, so Meta spreads delivery across its ads itself.
 *
 * ── NOTHING HERE DECIDES WHO ACTS ─────────────────────────────────────────────────────────────────────
 * Who may do each act is `ADS_AUTHORITY`'s alone. A step names the acts it is made of; a locked Autopilot is locked
 * because the table gives none of its acts to the agent — not because this file says "locked" (pinned by "a locked
 * mode is locked by the authority table, not by its words"). The words beside it say what would open it.
 */

/**
 * The act each move of the campaign machine is (`campaignMachine.ts`). The machine may allow nobody the table does
 * not (pinned by "the machine lets nobody act whom the authority table forbids"), so a row added to the machine
 * must be named here, and the table decides who may cause it. `null`: a fact the platform reported, never chosen.
 */
export const CAMPAIGN_EVENT_ACT: Readonly<Record<CampaignEvent, AdsAct | null>> = {
  plan: "write_plan", plan_ready: "record_outcome", plan_failed: "record_outcome",
  plan_approved: "approve_plan", replan: "approve_plan", resume_plan: "resume_after_failure",
  creatives_ready: "record_outcome", compose_failed: "record_outcome", regenerate: "regenerate", creatives_approved: "approve_creative",
  create_paused: "create_paused", created: "record_outcome", create_failed: "record_outcome",
  launch: "launch", launched: "record_outcome", launch_failed: "record_outcome",
  pause: "pause", paused: "record_outcome", pause_failed: "record_outcome",
  // The kill switch's move is a pause of everything: the safe direction (the switch itself is `kill_switch_on`).
  kill: "pause",
  platform_paused: null, platform_activated: null, platform_rejected: null,
  archive: "archive", resume_compose: "resume_after_failure", resume_create: "resume_after_failure",
};

export const AD_MODES = ["manual", "assisted", "autopilot"] as const;
export type AdMode = (typeof AD_MODES)[number];

export interface AdStepMode {
  mode: AdMode;
  /** What happens in this mode, in office words. */
  said: string;
  /** The acts this mode is made of; who may do each is the authority table's. */
  acts: readonly AdsAct[];
  /** Set when the mode cannot be chosen: what opens it. The table is what keeps it shut. */
  opens_when?: string;
}

export interface AdStep {
  key: AdStepKey;
  label: string;
  modes: readonly AdStepMode[];
  /** The mode in force for this carrier, read from where the choice is stored — never a second copy of it. */
  modeIn: (settings: AdsSettings) => AdMode;
}

export const AD_STEP_KEYS = ["start_campaign", "approve_plan", "approve_ad", "launch", "replace_tired_ad", "lower_budget"] as const;
export type AdStepKey = (typeof AD_STEP_KEYS)[number];

const LEVEL_C = "Opens only after 50 real ads decided by a person with the judge agreeing (κ ≥ 0.8), counsel's wording list complete, and one ad in ten still shown to a person (Q-APX1, Level C).";
const LEVEL_B = "Opens after the canary: one real campaign launched by the owner and run for 72 hours (Q-APX1, Level B).";

export const AD_STEPS: readonly AdStep[] = [
  {
    key: "start_campaign", label: "Start a campaign for an opening",
    modes: [
      { mode: "manual", said: "A person starts it from Campaigns, for an open opening.", acts: ["start_campaign"] },
      // Nothing is created and nothing is spent until a person presses Start: the agent's part is finding the opening
      // and filling in the form. Starting stays `start_campaign`, a person's.
      { mode: "assisted", said: "Every open opening with no campaign is listed under Needs you with the form filled in; a person presses Start.", acts: ["start_campaign"] },
    ],
    modeIn: (s) => modesOf(s).start_campaign,
  },
  {
    key: "approve_plan", label: "Approve the plan",
    modes: [{ mode: "assisted", said: "The Strategist writes the plan from the research; a person approves it, edits it or asks for another.", acts: ["write_plan", "approve_plan"] }],
    modeIn: () => "assisted",
  },
  {
    key: "approve_ad", label: "Approve an ad",
    modes: [
      { mode: "assisted", said: "The agents make and check every ad; a person approves or rejects each one.", acts: ["pick_presets_compose_render_check", "approve_creative"] },
      { mode: "autopilot", said: "An ad goes out without a person seeing it.", acts: ["approve_creative"], opens_when: LEVEL_C },
    ],
    modeIn: () => "assisted",
  },
  {
    key: "launch", label: "Launch",
    modes: [
      { mode: "assisted", said: "An admin approves the budget and launches; a second admin above the amount set in Settings.", acts: ["launch"] },
      { mode: "autopilot", said: "A campaign whose plan and ads a person approved launches inside a monthly envelope an admin approved once.", acts: ["launch"], opens_when: LEVEL_B },
    ],
    modeIn: () => "assisted",
  },
  {
    key: "replace_tired_ad", label: "Replace a tired ad",
    modes: [
      { mode: "manual", said: "A tired ad is reported; a person decides what to do.", acts: [] },
      { mode: "assisted", said: "A tired ad is retired, a new one is made, a person approves it, and it goes on by itself.", acts: ["retire_tired_ad", "pick_presets_compose_render_check", "approve_creative", "turn_on_approved_replacement"] },
    ],
    // The switch that already chose this (`creative_refresh.retire`, CQ9): read, not restated.
    modeIn: (s) => (s.creative_refresh.retire ? "assisted" : "manual"),
  },
  {
    // V5 part 2. The table lets the agent lower too (Level A), but no rule says WHEN it should — the Monitor pauses,
    // it never lowers — so offering Autopilot here would describe code that does not exist. Plan Q-APX23.
    key: "lower_budget", label: "Lower a running campaign's daily budget",
    modes: [{ mode: "manual", said: "A person lowers it from the campaign, with a reason; it takes effect at the ad platform at once.", acts: ["lower_budget"] }],
    modeIn: () => "manual",
  },
];

/**
 * The open openings with no campaign, for Assisted start (V5 part 3). A campaign that is archived no longer runs for
 * its opening, so the opening is offered again; any other state — failed included — is a campaign a person still
 * has to decide about, and offering a second one beside it would start a duplicate.
 *
 * NULL when the list may be cut off: the list door answers a carrier's newest `CAMPAIGN_LIST_LIMIT`, so with that
 * many an older campaign still standing could be missing, and its opening would be offered twice. Not a guess.
 */
export function openingsAwaitingCampaign<O extends { value: string }>(
  openings: readonly O[],
  campaigns: readonly { brief_source: string; brief_ref: string; state: string }[],
  source: string,
): O[] | null {
  if (campaigns.length >= CAMPAIGN_LIST_LIMIT) return null;
  const running = new Set(campaigns.filter((c) => c.brief_source === source && c.state !== "archived").map((c) => c.brief_ref));
  return openings.filter((o) => !running.has(o.value));
}

/** Whether a mode can be chosen: every agent act in it is the agent's by the table (a mode with no agent act always can). */
export function modeOpen(m: AdStepMode): boolean {
  if (m.mode !== "autopilot") return true;
  return m.acts.every((a) => (ADS_AUTHORITY[a] as readonly string[]).includes("agent"));
}
