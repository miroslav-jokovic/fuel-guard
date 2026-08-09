/** Card-identity context for scoring one fill (WP3, hardened WP3b) — true-card vehicle count, the
 * AS-OF-FILL-TIME learned assignment, and any manual (human) assignment.
 *
 * Counted by the TRUE CARD, never by driver: candidate fills are fetched by control_id (and by
 * card_ref only when this fill carries an UNMASKED full card number — see below), then filtered with
 * sameCardFill, so two drivers sharing a last-4 are never conflated and a slip-seat driver's
 * DIFFERENT per-truck cards never inflate one card's count. A masked ref with no control id stays
 * uncounted (unidentifiable — surfaced in detection coverage, never guessed at).
 *
 * WP3b (169-false-alarm fix): the learned assignment is computed AS OF THE FILL — the dominant vehicle
 * over the 60 days BEFORE it — so a rebuild judges each fill against the assignment true THEN, never
 * today's. It is evidence-only (never fires alone). fuel_cards' current state is consulted ONLY for
 * MANUAL assignments (human ground truth), and only for fills recent enough for the record to apply.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardIdentityKey, isFullCardNumber, sameCardFill, dominantVehicle, eventTime, timeReliable, type TxnView } from "@fuelguard/shared";
import { EVENT_TIME_QUERY_SLACK_MS, rowEventTime } from "./loaders.js";

/** As-of learning window (days before the fill) — matches the nightly learner's window. */
const ASSIGN_WINDOW_DAYS = 60;
/** A manual fuel_cards assignment is applied only to fills within this many days of NOW — we don't
 *  track when a human set it, so applying it deep into history would recreate the era-change bug. */
const MANUAL_APPLICABLE_DAYS = 60;

export interface CardContext {
  /** Distinct vehicles this CARD fueled within the window (incl. this fill). 0 when unidentifiable. */
  cardVehicleCountInWindow: number;
  /** As-of-fill-time learned assignment (evidence-only), or null. */
  cardAssignedVehicleId: string | null;
  /** Manual (human-declared) assignment applicable to this fill, or null. */
  cardManualAssignedVehicleId: string | null;
  /** WP3c — could this fill's card be identified at all? Card-keyed rules stay silent when false. */
  cardIdentifiable: boolean;
}

const UNIDENTIFIABLE: CardContext = {
  cardVehicleCountInWindow: 0,
  cardAssignedVehicleId: null,
  cardManualAssignedVehicleId: null,
  cardIdentifiable: false,
};

export async function resolveCardContext(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
  winStartIso: string,
  fueledAt: string,
): Promise<CardContext> {
  const identityKey = cardIdentityKey(txn.cardRef, txn.controlId);
  if (!identityKey) return { ...UNIDENTIFIABLE };
  const me = { cardRef: txn.cardRef ?? null, controlId: txn.controlId ?? null };
  const anchorIso = timeReliable(txn) ? eventTime(txn) : fueledAt;
  const anchorMs = Date.parse(anchorIso);
  const assignStartIso = new Date(anchorMs - ASSIGN_WINDOW_DAYS * 86_400_000).toISOString();
  // Include business timestamps on either side of the event anchor; filtering below uses the effective event time.
  const assignEndIso = new Date(anchorMs + EVENT_TIME_QUERY_SLACK_MS).toISOString();

  // ONE fetch covers both needs: the card's fills over the trailing 60 days (as-of assignment) — the
  // short misuse window (count) is a subset filtered in code.
  //
  // WP3c — WHICH COLUMNS WE MAY SCAN BY:
  //   • control_id is always safe: it is the disambiguator, and sameCardFill still filters the result.
  //   • card_ref is scanned ONLY when this fill carries an unmasked full card number. Since EFS began
  //     masking, a card_ref scan on a bare/masked ref returns EVERY card in the org ending in those 4
  //     digits. That was not just wasted work: the `limit(400)` is applied by Postgres (fueled_at desc)
  //     BEFORE sameCardFill runs here, so on a busy shared last-4 the card's own fills were evicted
  //     from the page — silently corrupting both the count and the as-of assignment.
  // An identifiable masked fill always has a control id (that is what makes it identifiable), so
  // dropping the ref scan for those loses no candidates.
  const scanCols: ("card_ref" | "control_id")[] = [];
  if (txn.controlId) scanCols.push("control_id");
  if (txn.cardRef && isFullCardNumber(txn.cardRef)) scanCols.push("card_ref");

  type CardRow = {
    id: string;
    card_ref: string | null;
    control_id: string | null;
    vehicle_id: string | null;
    fueled_at: string;
    fueled_at_precision: string | null;
    source: string;
    fueling_time_basis: string | null;
    samsara_recon_at: string | null;
    samsara_location_matched: boolean | null;
  };
  const seen = new Map<string, CardRow>();
  for (const col of scanCols) {
    const val = col === "card_ref" ? txn.cardRef : txn.controlId;
    if (!val) continue;
    const { data: rows } = await admin
      .from("fuel_transactions")
      .select("id, card_ref, control_id, vehicle_id, fueled_at, fueled_at_precision, source, fueling_time_basis, samsara_recon_at, samsara_location_matched")
      .eq("org_id", orgId)
      .eq("is_canonical", true)
      .eq(col, val)
      .gte("fueled_at", assignStartIso)
      .lte("fueled_at", assignEndIso)
      .order("fueled_at", { ascending: false })
      .limit(400);
    for (const x of (rows ?? []) as CardRow[]) {
      seen.set(x.id, x);
    }
  }
  const mine = [...seen.values()]
    .filter((x) => sameCardFill({ cardRef: x.card_ref, controlId: x.control_id }, me))
    .filter((x) => {
      const at = Date.parse(rowEventTime(x));
      return Number.isFinite(at) && at >= Date.parse(assignStartIso) && at <= anchorMs;
    })
    .sort((a, b) => Date.parse(rowEventTime(a)) - Date.parse(rowEventTime(b)) || a.id.localeCompare(b.id));

  const cardVehicleCountInWindow = new Set(
    mine.filter((x) => Date.parse(rowEventTime(x)) >= Date.parse(winStartIso) && Date.parse(rowEventTime(x)) <= anchorMs)
      .map((x) => x.vehicle_id).filter(Boolean),
  ).size;

  // As-of assignment: dominant vehicle over the trailing window, EXCLUDING the fill being scored (a
  // fill must never vote for its own legitimacy).
  const cardAssignedVehicleId = dominantVehicle(mine.filter((x) => x.id !== txn.id).map((x) => x.vehicle_id));

  // Manual assignment (current state, human ground truth) — applied only to recent-era fills.
  let cardManualAssignedVehicleId: string | null = null;
  const fillAgeDays = (Date.now() - anchorMs) / 86_400_000;
  if (fillAgeDays <= MANUAL_APPLICABLE_DAYS) {
    const { data: manualRow } = await admin
      .from("fuel_cards")
      .select("vehicle_id")
      .eq("org_id", orgId)
      .eq("card_ref", identityKey)
      .eq("assignment_source", "manual")
      .not("vehicle_id", "is", null)
      .maybeSingle();
    cardManualAssignedVehicleId = (manualRow?.vehicle_id as string | null) ?? null;
  }

  return { cardVehicleCountInWindow, cardAssignedVehicleId, cardManualAssignedVehicleId, cardIdentifiable: true };
}
