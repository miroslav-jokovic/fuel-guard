import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import type { CardSummaryRow } from "../lib/efsCardOps.js";
import { cardRefHmac } from "./efsCardRef.js";
import { signalMirrorTombstoneRefused } from "../lib/cardControlSignals.js";

/**
 * Which mirrored cards has WEX stopped listing? (audit P2, and Step 7.5's ratio guard)
 *
 * Split out of `efsCardMirror.ts` when the ratio guard took that file past the 500-line budget —
 * split, not waived, for the reason `efsCardLinking.ts` gives: a waiver pins the file at its current
 * length and makes the next addition somebody else's problem. The seam is a real one. Mirroring
 * answers "what does EFS say about this card"; this answers "does EFS still have this card at all",
 * and that second question is the one where being wrong destroys information rather than delaying it.
 */

/**
 * The share of an org's live mirror one sweep may mark absent.
 *
 * Step 7.5, in the plan's own words: *"today a partial roster of 40/199 stamps `absent_since` on 159
 * live cards"*. The only guard was a non-empty roster, which catches the vendor returning NOTHING and
 * nothing else — and a truncated or partially-failed roster is the far likelier shape, because
 * `getCardSummaries` returns the entire fleet in one response and a short response is not an error.
 *
 * 20% is chosen against what a legitimate mass-removal looks like: a depot closing, or a policy
 * retired, is tens of cards on a fleet of hundreds. Anything larger arriving in ONE sweep, with no
 * human having touched this system, is far more likely to be a bad roster than a bad day. The guard
 * fails toward keeping rows live: an absent card that stays live for another cycle shows a stale
 * document, while a live card wrongly tombstoned drops out of `linkFuelCards` and out of every count
 * built on `absent_since is null`.
 */
const MAX_TOMBSTONE_SHARE = 0.2;

/**
 * …except on a small fleet, where any single removal is a large fraction.
 *
 * QA runs 35 cards, where one card is already 3%. Without a floor the guard would refuse the first
 * genuinely de-listed card on a small account and never let it through. Five is bounded damage —
 * `absent_since` is reversible and cleared the moment a card reappears — and it is below the 40-card
 * partial roster this guard was filed for.
 */
const MIN_TOMBSTONES_ALLOWED = 5;

export interface TombstoneResult {
  /** Newly marked absent this sweep. Zero when the guard refused — see `refused`. */
  tombstoned: number;
  /** Cards the roster stopped listing, whether or not they were marked. */
  candidates: number;
  /** True when the ratio guard held the sweep back. The rows are untouched and the signal is emitted. */
  refused: boolean;
}

/**
 * Mark cards the roster no longer returns as absent, and clear the mark from cards that came back.
 *
 * A card removed in the WEX portal drops out of getCardSummaries silently (audit P2). Never a hard
 * delete — efs_card_mutations cascades from efs_cards, and a removed card's history is exactly what
 * an auditor asks about. `absent_since` is set once (first sweep that misses it) and cleared the
 * moment it reappears, so a transient roster hiccup does not keep re-stamping the timestamp.
 *
 * Two guards, and they answer different failures:
 *   • a NON-EMPTY roster — a sweep that legitimately returns zero cards is indistinguishable here
 *     from a vendor blip that returned nothing, and tombstoning the ENTIRE fleet on one empty
 *     response is the kind of damage this file refuses elsewhere. Zero summaries → touch nothing.
 *   • the RATIO — see MAX_TOMBSTONE_SHARE. The empty-roster guard only ever caught the extreme.
 *
 * Clearing is NOT rate-limited. Marking a live card absent loses information; clearing the mark from
 * a card the vendor is listing again restores it, and a guard on the recovery path would leave the
 * mirror stuck in whatever wrong state a bad sweep put it in.
 */
export async function tombstoneAbsentCards(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  summaries: readonly CardSummaryRow[],
): Promise<TombstoneResult> {
  const none: TombstoneResult = { tombstoned: 0, candidates: 0, refused: false };
  if (summaries.length === 0) return none;
  const present = new Set(summaries.map((s) => cardRefHmac(env, orgId, s.cardNumber)));

  // Read the org's hmac + current absent flag in pages (same max-rows discipline as the roster read).
  const rows: { card_ref_hmac: string; absent_since: string | null }[] = [];
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("efs_cards")
      .select("card_ref_hmac, absent_since")
      .eq("org_id", orgId)
      .order("card_ref_hmac", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return none; // best effort: a tombstone failure must not fail the whole sweep
    const page = (data ?? []) as { card_ref_hmac: string; absent_since: string | null }[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const nowIso = new Date().toISOString();
  const toMark = rows.filter((r) => !present.has(r.card_ref_hmac) && r.absent_since === null).map((r) => r.card_ref_hmac);
  const toClear = rows.filter((r) => present.has(r.card_ref_hmac) && r.absent_since !== null).map((r) => r.card_ref_hmac);

  if (toClear.length > 0) {
    await admin.from("efs_cards").update({ absent_since: null }).eq("org_id", orgId).in("card_ref_hmac", toClear);
  }
  if (toMark.length === 0) return none;

  // Measured against the LIVE mirror, not the whole table: cards already absent are not at risk and
  // counting them would make the guard laxer on exactly the org that has been losing cards.
  const live = rows.filter((r) => r.absent_since === null).length;
  const ceiling = Math.max(MIN_TOMBSTONES_ALLOWED, Math.floor(live * MAX_TOMBSTONE_SHARE));
  if (toMark.length > ceiling) {
    signalMirrorTombstoneRefused({
      orgId,
      candidates: toMark.length,
      liveCards: live,
      rosterCards: summaries.length,
      ceiling,
    });
    return { tombstoned: 0, candidates: toMark.length, refused: true };
  }

  await admin.from("efs_cards").update({ absent_since: nowIso }).eq("org_id", orgId).in("card_ref_hmac", toMark);
  return { tombstoned: toMark.length, candidates: toMark.length, refused: false };
}
