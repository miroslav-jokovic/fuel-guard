import {
  CAMPAIGN_STATE_SET, CAMPAIGN_TRANSITIONS,
  type ActionKind, type AdsLedgerEntry, type CampaignState, type NeedsYouItem,
} from "@silvicom/shared";
import { CAMPAIGN_STATE_LABEL } from "./adsCampaignFlow";

/**
 * The Overview's rows in office words (V6). Pure, so each sentence is tested without a browser. The facts are the
 * API's (`AdsOverviewView`); this file only words them, and where a word can be read from the machine it is.
 */

/** Every action kind the ledger can hold, worded once (a `Record`, so a kind added to the contract fails to compile here). */
export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  transition: "Moved",
  create_paused: "Created on the platform, paused",
  launch: "Launched",
  pause: "Paused",
  lower_budget: "Budget lowered",
  raise_budget: "Budget raised",
  change_area: "Area changed",
  archive: "Archived",
  kill: "Kill switch",
  external_change: "Changed outside Silvicom",
  rules_sync: "Automatic rules sent to the platform",
  connection_test: "Connection tested",
  reconcile: "Daily check against the platform",
  retire_ad: "Tired ad taken down",
  activate_ad: "Replacement ad turned on",
};

const stateWord = (s: string): string => (CAMPAIGN_STATE_SET.has(s as CampaignState) ? CAMPAIGN_STATE_LABEL[s as CampaignState] : s);

/**
 * What one ledger row did. A move is worded by where it went — read from the machine (`CAMPAIGN_TRANSITIONS`), since
 * the row holds the state it left and the event, not the state it reached.
 */
export function ledgerWhat(e: Pick<AdsLedgerEntry, "kind" | "from_state" | "event">): string {
  if (e.kind !== "transition" || !e.from_state || !e.event) return ACTION_KIND_LABEL[e.kind] ?? e.kind;
  const to = CAMPAIGN_TRANSITIONS.find((t) => t.from === e.from_state && t.event === e.event)?.to;
  if (!to || to === e.from_state) return `${stateWord(e.from_state)} (${e.event.replace(/_/g, " ")})`;
  return `${stateWord(e.from_state)} → ${stateWord(to)}`;
}

/** The outcome, and its badge tone. A row that succeeded says so quietly; a refusal is the guard saying no. */
export const LEDGER_STATUS: Record<AdsLedgerEntry["status"], { label: string; tone: string }> = {
  succeeded: { label: "Done", tone: "neutral" },
  started: { label: "In progress", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  refused: { label: "Refused", tone: "warning" },
};

export const NEEDS_TONE: Record<NeedsYouItem["tone"], string> = { bad: "danger", warn: "warning" };

/**
 * Where a "Needs you" row takes the person: a campaign opens in the Campaigns tab's drawer (its `?campaign=` link);
 * the switch, a cap and a connection are Settings'. Null when that tab is not this person's to open — the row still
 * says what is wrong, and the admin who can fix it sees the link.
 */
export function needsYouLink(item: Pick<NeedsYouItem, "campaign_id">, canOpenSettings: boolean): { path: string; query?: Record<string, string> } | null {
  if (item.campaign_id) return { path: "/ads/campaigns", query: { campaign: item.campaign_id } };
  return canOpenSettings ? { path: "/ads/settings" } : null;
}
