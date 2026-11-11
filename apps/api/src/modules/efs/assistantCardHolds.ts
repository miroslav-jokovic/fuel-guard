import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOL_PAGE, canonicalEfsStatus, EFS_CARD_STATUS_LABELS, efsStatusEquals, fuelCardsToQuery, reachableSyncFloor, type EfsCardStatus, type EfsCardSummary } from "@silvicom/shared";
import { listEfsCards } from "./services/efsCardList.js";

/**
 * The assistant's `card_holds` tool (F21 R6b, 2026-11-10): which fuel cards are on hold or on a fraud
 * hold right now, from the Fuel Cards page (`/fuel-cards`), asked in words.
 *
 * ── WHY IT CALLS `listEfsCards` AND NOTHING ELSE ─────────────────────────────────────────────────
 * `listEfsCards` is the page's list read (`GET /api/fuel-cards`), moved into a service for this tool
 * so both read the same mirror rows through the same `cardRowToSummary`, the one place a card is
 * masked. Statuses are compared with `efsStatusEquals` and worded with `EFS_CARD_STATUS_LABELS`, the
 * page's own filter words ("On hold", "Fraud hold"); the "checked" clock is `reachableSyncFloor`,
 * the page's banner rule, moved to shared with this tool. Nothing here reads `efs_cards` itself.
 *
 * ── WHAT IS NEVER IN THE ANSWER (D-AI7) ──────────────────────────────────────────────────────────
 * A card is named by truck, driver and its last four, the way the bell names it (`cardLabel`): never
 * a full number, which the summary never carries anyway. The driver-id prompt is left out too; it is
 * a PIN-like value the pump asks for, and a report has no use for it.
 *
 * ── A CARD EFS NO LONGER LISTS ───────────────────────────────────────────────────────────────────
 * The mirror keeps it (`absentSince`) with its last status, so a card WEX dropped can still read FRAUD
 * months later (memory `wex-fraud-hold-visibility`: ••7967 since 09-23). The page badges it; here it is
 * counted apart and flagged, never in the "on hold now" count.
 *
 * Gated as its page is: `fuel: view` (`assistantContract.ts`). This reads only our database, so it
 * does not need the EFS-whitelisted host that the vendor calls on the same prefix do.
 *
 * ORG-SCOPED: `listEfsCards` chains `org_id`.
 */

export const CARD_HOLDS_SOURCE = "Fuel cards page (/fuel-cards), the card statuses that page shows";
export const CARD_HOLD_STATUSES = ["Hold", "Fraud"] as const satisfies readonly EfsCardStatus[];
export const MAX_CARD_HOLDS_LISTED = 50;

export interface AssistantCardHoldsInput {
  status?: unknown;
}

const statusWord = (s: string): string => {
  const known = canonicalEfsStatus(s);
  return known && known in EFS_CARD_STATUS_LABELS ? EFS_CARD_STATUS_LABELS[known as EfsCardStatus] : s;
};

const card = (c: EfsCardSummary) => ({
  card: c.maskedRef,
  truck: c.unitPrompt,
  driver: c.driverName,
  status: statusWord(c.status),
  last_used: c.lastUsedDate,
  checked_at: c.syncedAt,
  ...(c.absentSince ? { no_longer_listed_by_efs_since: c.absentSince } : {}),
});

export async function assistantCardHolds(admin: SupabaseClient, orgId: string, input: AssistantCardHoldsInput): Promise<unknown> {
  const list = await listEfsCards(admin, orgId);
  if (!list.ok) throw new Error(list.error.message ?? "Could not load the card list");
  const only = (CARD_HOLD_STATUSES as readonly string[]).find((s) => efsStatusEquals(s, String(input.status ?? ""))) ?? null;

  const listed = list.cards.filter((c) => !c.absentSince);
  const counts: Record<string, number> = {};
  for (const c of listed) counts[statusWord(c.status)] = (counts[statusWord(c.status)] ?? 0) + 1;

  const held = list.cards
    .filter((c) => (only ? [only] : CARD_HOLD_STATUSES).some((s) => efsStatusEquals(c.status, s)))
    // Fraud first, then hold; within each, by truck as the bell names them.
    .sort((a, b) =>
      Number(efsStatusEquals(b.status, "Fraud")) - Number(efsStatusEquals(a.status, "Fraud")) ||
      String(a.unitPrompt ?? "~").localeCompare(String(b.unitPrompt ?? "~"), undefined, { numeric: true }),
    );
  const heldNow = held.filter((c) => !c.absentSince);
  const heldGone = held.filter((c) => c.absentSince);

  return {
    source: CARD_HOLDS_SOURCE,
    cards_checked_at: reachableSyncFloor(list.cards),
    cards_on_the_account: listed.length,
    by_status: counts,
    on_hold_now: heldNow.filter((c) => efsStatusEquals(c.status, "Hold")).length,
    fraud_hold_now: heldNow.filter((c) => efsStatusEquals(c.status, "Fraud")).length,
    cards: heldNow.slice(0, MAX_CARD_HOLDS_LISTED).map(card),
    ...(heldNow.length > MAX_CARD_HOLDS_LISTED ? { cards_note: `${MAX_CARD_HOLDS_LISTED} of ${heldNow.length} held cards listed.` } : {}),
    ...(heldGone.length > 0
      ? {
          no_longer_listed_by_efs: heldGone.map(card),
          no_longer_listed_note: "EFS stopped listing these cards; the status is the last one it reported, not a current hold.",
        }
      : {}),
    // F21 R4b: the page filtered to the ONE status asked about; "Hold or Fraud" is not one parameter, so
    // that answer links to the page itself. Lifted off before the model sees the result (D-AI8).
    ...(only ? { link: { surfaceKey: ASSISTANT_TOOL_PAGE.card_holds, query: fuelCardsToQuery({ status: only as EfsCardStatus }) } } : {}),
  };
}
