import {
  ADS_PERSON_DOOR_EXCLUDED, campaignEventsFrom,
  type AdCheckVerdict, type AdCreativeCheck, type CampaignEvent, type CampaignState, type CreativeState,
} from "@silvicom/shared";

/**
 * The campaign page's rules (E3), kept apart from the screens so they can be tested without them.
 *
 * Which moves a campaign offers is the MACHINE's (`campaignEventsFrom`), never a list here: this file only words
 * them. A person's moves are the machine's person events minus the two with their own door
 * (`ADS_PERSON_DOOR_EXCLUDED`: the kill switch and Launch), so a button cannot disagree with what the door allows.
 */
export const CAMPAIGN_STATE_LABEL: Record<CampaignState, string> = {
  draft: "Starting", composing: "Making the ads", review: "Waiting for review", approved: "Approved",
  creating: "Creating on the platform", paused: "Paused", launching: "Launching", live: "Live",
  pausing: "Pausing", archived: "Archived", failed: "Stopped",
};

export const CAMPAIGN_STATE_TONE: Record<CampaignState, string> = {
  draft: "neutral", composing: "info", review: "warning", approved: "info", creating: "info", paused: "neutral",
  launching: "info", live: "success", pausing: "info", archived: "neutral", failed: "danger",
};

export const CREATIVE_STATE_LABEL: Record<CreativeState, string> = {
  generating: "Being made", checking: "Being checked", check_failed: "Failed a check", ready: "Ready for review",
  approved: "Approved", rejected: "Rejected", live: "Live", paused: "Paused", archived: "Archived",
};

/** D-AD12's three checks in office words: the words, the text drawn on the picture, and the picture itself. */
export const CHECK_LABEL: Record<AdCreativeCheck, string> = { copy: "Words", render: "Text on the picture", visual: "Picture" };
export const CHECK_VERDICT_LABEL: Record<AdCheckVerdict, string> = { passed: "Passed", failed: "Failed", not_run: "Not checked" };
export const CHECK_VERDICT_TONE: Record<AdCheckVerdict, string> = { passed: "success", failed: "danger", not_run: "neutral" };

/** The agent is working: the page reads the campaign again until it stops. */
const WORKING: ReadonlySet<CampaignState> = new Set<CampaignState>(["draft", "composing", "approved", "creating", "launching", "pausing"]);
export const isWorking = (s: CampaignState): boolean => WORKING.has(s);

const MOVE_LABEL: Partial<Record<CampaignEvent, string>> = {
  regenerate: "Make new ads", creatives_approved: "Approve this campaign", create_paused: "Create it paused",
  pause: "Pause", archive: "Archive", resume_compose: "Try making the ads again", resume_create: "Try creating it again",
};

export interface CampaignMove { event: CampaignEvent; label: string }

/** What a person who manages recruiting may press from this state. */
export function personMoves(state: CampaignState): CampaignMove[] {
  return campaignEventsFrom(state)
    .filter((t) => t.by.includes("person") && !ADS_PERSON_DOOR_EXCLUDED.includes(t.event))
    .map((t) => ({ event: t.event, label: MOVE_LABEL[t.event] ?? t.event }));
}

/** The copy of one language as label and text, in the order the creative holds it. */
export function copyLines(copy: Record<string, unknown> | null, language: string): Array<{ slot: string; text: string }> {
  const lines = copy?.[language];
  if (!lines || typeof lines !== "object") return [];
  return Object.entries(lines as Record<string, unknown>).flatMap(([slot, text]) => (typeof text === "string" ? [{ slot, text }] : []));
}
