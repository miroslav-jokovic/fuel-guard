import { CAMPAIGN_STATES, type CampaignState } from "./contracts.js";

/**
 * The orchestrator's state machine (D-AD16): a campaign's whole life as a closed table of
 * (state, event) → state, with who may cause each move. The orchestrator in apps/api is a runner over
 * this table and nothing more — it decides no step itself, so no model and no code path can invent a
 * transition. Pure: no clock, no I/O.
 *
 * ── HOW TO READ A ROW ──────────────────────────────────────────────────────────────────────────────
 * `by` is who may cause the move:
 *   agent     — the orchestrator or a worker, unattended
 *   person    — any member allowed on the campaign's section
 *   approver  — a person whose approval row the act cites (D-AD2; the database checks it too, AX020)
 *   platform  — a fact the platform reported (a status change, a rejection), mirrored, never chosen
 * `spend` marks a move that can increase spend: the guard (`adsPolicy`) must pass before it.
 *
 * ── THE RULES THE TABLE ENCODES ────────────────────────────────────────────────────────────────────
 * - Everything reaches the platform PAUSED first (`create_paused` → `paused`); only `launch`, by an
 *   approver, starts delivery.
 * - The safe direction is always open: `pause` and `kill` are legal from every state that can spend,
 *   and `kill` is a legal no-op everywhere else, so pressing the kill switch never errors.
 * - A failure is a visible state (`failed`), never a silent retry loop; leaving it is a person's act.
 * - `archived` is the only end. Nothing is deleted (plan §5).
 * - A platform-side change (someone used Ads Manager) is mirrored, because the platform is the truth
 *   about delivery; the runner records it as `external_change` (D-AD4).
 */

export const CAMPAIGN_EVENTS = [
  "plan", "plan_ready", "plan_failed", "plan_approved", "replan", "resume_plan",
  "creatives_ready", "compose_failed", "regenerate", "creatives_approved",
  "create_paused", "created", "create_failed", "launch", "launched", "launch_failed",
  "pause", "paused", "pause_failed", "kill", "platform_paused", "platform_activated",
  "platform_rejected", "archive", "resume_compose", "resume_create",
] as const;
export type CampaignEvent = (typeof CAMPAIGN_EVENTS)[number];

export type CampaignActor = "agent" | "person" | "approver" | "platform";

export interface CampaignTransition {
  from: CampaignState;
  event: CampaignEvent;
  to: CampaignState;
  by: readonly CampaignActor[];
  /** True when the move can increase spend: `adsPolicy` must allow it first. */
  spend: boolean;
}

const T = (
  from: CampaignState, event: CampaignEvent, to: CampaignState, by: readonly CampaignActor[], spend = false,
): CampaignTransition => ({ from, event, to, by, spend });

const AGENT = ["agent"] as const;
const PERSON = ["person"] as const;
const EITHER = ["agent", "person"] as const;
const PLATFORM = ["platform"] as const;

/** States in which the platform may be delivering (or about to), so a pause is meaningful. */
const CAN_DELIVER: readonly CampaignState[] = ["launching", "live"];
/** States the kill switch leaves where they are: nothing is delivering, and nothing launches while it is on. */
const KILL_NO_OP: readonly CampaignState[] = [
  "draft", "planning", "plan_review", "composing", "review", "approved", "creating", "paused", "pausing", "archived", "failed",
];

export const CAMPAIGN_TRANSITIONS: readonly CampaignTransition[] = [
  // planning (V2, 0606): the evidence pack is built and the Strategist writes the plan from it; a person
  // approves or edits it, and only that names the plan the campaign composes from (`plan_approved` writes
  // `plan_id` in the same compare-and-set, `transitions.ts`; AX032 refuses the move without it).
  T("draft", "plan", "planning", AGENT),
  T("planning", "plan_ready", "plan_review", AGENT),
  T("planning", "plan_failed", "failed", AGENT),
  T("plan_review", "plan_approved", "composing", PERSON),
  T("plan_review", "replan", "planning", PERSON),
  // composing: the workers write, render and check one creative per angle of the approved plan.
  // There is ONE road into it (Q-APX6, ruled (b) by the owner on 2026-11-15: "planning should be mandatory"):
  // `plan_review → composing`, on a person's approval. The row `draft → compose → composing`, the road with no
  // plan, stood here while planning was the carrier's choice and left with that ruling, and its event with it.
  T("composing", "creatives_ready", "review", AGENT),
  T("composing", "compose_failed", "failed", AGENT),
  T("review", "regenerate", "composing", PERSON),
  T("review", "creatives_approved", "approved", PERSON),
  // reaching the platform, paused
  T("approved", "create_paused", "creating", EITHER),
  T("creating", "created", "paused", AGENT),
  T("creating", "create_failed", "failed", AGENT),
  // delivery: only an approver starts it
  T("paused", "launch", "launching", ["approver"], true),
  T("launching", "launched", "live", AGENT),
  T("launching", "launch_failed", "paused", AGENT),
  // the safe direction
  ...CAN_DELIVER.map((s) => T(s, "pause", "pausing", EITHER)),
  T("pausing", "paused", "paused", AGENT),
  T("pausing", "pause_failed", "pausing", AGENT),
  ...CAN_DELIVER.map((s) => T(s, "kill", "pausing", EITHER)),
  ...KILL_NO_OP.map((s) => T(s, "kill", s, EITHER)),
  // what the platform did, mirrored
  T("live", "platform_paused", "paused", PLATFORM),
  T("launching", "platform_paused", "paused", PLATFORM),
  T("paused", "platform_activated", "live", PLATFORM),
  T("launching", "platform_rejected", "paused", PLATFORM),
  T("live", "platform_rejected", "paused", PLATFORM),
  // the only end
  // `planning` like `draft`: nothing has been made or spent, so a person may stop there.
  ...(["draft", "planning", "plan_review", "review", "approved", "paused", "failed"] as const).map((s) => T(s, "archive", "archived", EITHER)),
  // leaving a failure is a person's act; the runner resumes idempotently (every vendor call is keyed)
  T("failed", "resume_plan", "planning", PERSON),
  T("failed", "resume_compose", "composing", PERSON),
  T("failed", "resume_create", "creating", PERSON),
];

/**
 * States the database accepts and no row of the table enters. Empty since V2b gave `planning` and
 * `plan_review` their moves; it held those two for the one merge that carried migration 0606 alone.
 * Kept, empty, because `campaignMachine.test.ts` holds it equal to what the table actually leaves
 * unentered — so a state added to `CAMPAIGN_STATES` ahead of its moves has to be named here, on purpose.
 */
export const CAMPAIGN_STATES_AWAITING_ENTRY: readonly CampaignState[] = [];

const TABLE = new Map<string, CampaignTransition>(CAMPAIGN_TRANSITIONS.map((t) => [`${t.from}|${t.event}`, t]));

export type CampaignStep =
  | { ok: true; transition: CampaignTransition }
  | { ok: false; reason: "illegal_transition" | "actor_not_allowed"; from: CampaignState; event: CampaignEvent };

/**
 * The one question the runner asks. Illegal pairs refuse rather than throw, so the runner can record
 * the refusal in `ads_actions` like any other outcome.
 */
export function stepCampaign(from: CampaignState, event: CampaignEvent, actor: CampaignActor): CampaignStep {
  const t = TABLE.get(`${from}|${event}`);
  if (!t) return { ok: false, reason: "illegal_transition", from, event };
  if (!t.by.includes(actor)) return { ok: false, reason: "actor_not_allowed", from, event };
  return { ok: true, transition: t };
}

/** The events legal from a state, for the screens' buttons and the runner's next-job choice. */
export function campaignEventsFrom(from: CampaignState): CampaignTransition[] {
  return CAMPAIGN_TRANSITIONS.filter((t) => t.from === from);
}

/** `archived` is the only state nothing leaves. */
export function isTerminalCampaignState(s: CampaignState): boolean {
  return campaignEventsFrom(s).every((t) => t.to === s);
}

export const CAMPAIGN_STATE_SET: ReadonlySet<CampaignState> = new Set(CAMPAIGN_STATES);
