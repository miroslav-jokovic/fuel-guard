/**
 * CARD → TRUCK ASSIGNMENT (WP1 D4/D5) — populate and use `fuel_cards` as the card→vehicle ground truth.
 *
 * The standard EFS reject export does NOT carry the card-assigned truck (verified: 15 columns, no
 * Truck field), so the assignment must be learned on our side from approved-fill history and kept in
 * `fuel_cards`. Pure logic lives here (identity key, learner, mismatch assessment); the API service
 * does the queries/upserts.
 */

/** Digits-only view of a card ref (EFS pads with trailing spaces; some exports mask to last 4). */
const digits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/**
 * Stable identity key for one physical card. Full PAN (≥8 digits) when the export carries it; else
 * last4 + the EFS Driver Control ID (migration 0075: EFS sometimes masks cards to the last 4, which
 * collides across drivers — the control id disambiguates). Returns null when the row can't identify a
 * card reliably (bare last-4 with no control id) — callers must stay silent rather than guess.
 */
export function cardIdentityKey(cardRef: string | null | undefined, controlId?: string | null): string | null {
  const d = digits(cardRef);
  if (d.length >= 8) return d;
  if (d.length >= 4 && controlId) return `${d}|${controlId.trim()}`;
  return null;
}

/** Last 4 digits of a card ref (for the fuel_cards.card_last4 lookup path), or null. */
export function cardLast4(cardRef: string | null | undefined): string | null {
  const d = digits(cardRef);
  return d.length >= 4 ? d.slice(-4) : null;
}

export interface CardFillRow {
  cardRef: string | null;
  controlId: string | null;
  vehicleId: string | null;
}

export interface LearnedCardAssignment {
  cardKey: string;
  cardLast4: string | null;
  vehicleId: string;
  /** Share of the card's attributed fills on the winning vehicle (0–1). */
  share: number;
  fills: number;
}

/**
 * Learn which vehicle each card is assigned to from its recent attributed fills. A card is assigned
 * only with real evidence: ≥ `minFills` attributed fills AND a ≥ `minShare` majority on ONE vehicle —
 * a card that legitimately floats between trucks (slip-seat / spare card) yields NO assignment rather
 * than a wrong one (match-don't-guess, same posture as the unit/driver reconciliation). Pure.
 */
export function learnCardAssignments(
  rows: CardFillRow[],
  opts: { minFills?: number; minShare?: number } = {},
): LearnedCardAssignment[] {
  const minFills = opts.minFills ?? 5;
  const minShare = opts.minShare ?? 0.7;
  const byCard = new Map<string, { last4: string | null; byVehicle: Map<string, number>; total: number }>();
  for (const r of rows) {
    if (!r.vehicleId) continue;
    const key = cardIdentityKey(r.cardRef, r.controlId);
    if (!key) continue;
    const cur = byCard.get(key) ?? { last4: cardLast4(r.cardRef), byVehicle: new Map<string, number>(), total: 0 };
    cur.byVehicle.set(r.vehicleId, (cur.byVehicle.get(r.vehicleId) ?? 0) + 1);
    cur.total += 1;
    byCard.set(key, cur);
  }
  const out: LearnedCardAssignment[] = [];
  for (const [cardKey, c] of byCard) {
    if (c.total < minFills) continue;
    let winner: string | null = null;
    let winCount = 0;
    for (const [veh, n] of c.byVehicle) {
      if (n > winCount) {
        winCount = n;
        winner = veh;
      }
    }
    const share = winCount / c.total;
    if (winner && share >= minShare) {
      out.push({ cardKey, cardLast4: c.last4, vehicleId: winner, share: Math.round(share * 100) / 100, fills: c.total });
    }
  }
  return out;
}

/**
 * Do two card refs denote the same physical card? Handles EFS's mixed formats (F5): full 19-digit PAN
 * on one report, masked last-4 on the other, padding/whitespace. True when the digit strings are equal
 * OR one (≥4 digits) is the trailing suffix of the other (a masked ref vs its full PAN). Pure.
 */
export function cardRefsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digits(a);
  const db = digits(b);
  if (da.length < 4 || db.length < 4) return false;
  if (da === db) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return long.endsWith(short);
}

/**
 * Are two FILL rows the same physical card? (WP3 — the card_multi_vehicle identity test.) True when the
 * card refs match digit-wise (full/masked tolerant) AND the EFS control ids don't contradict: two rows
 * sharing a last-4 but carrying DIFFERENT control ids are two different drivers' cards (the 0075
 * conflation), never the same card. A missing control id on either side doesn't block the match. Pure.
 */
export function sameCardFill(
  a: { cardRef: string | null; controlId: string | null },
  b: { cardRef: string | null; controlId: string | null },
): boolean {
  if (!cardRefsMatch(a.cardRef, b.cardRef)) return false;
  const ca = a.controlId?.trim();
  const cb = b.controlId?.trim();
  return !ca || !cb || ca === cb;
}

// ── decline-time assessment ──────────────────────────────────────────────────────────────────────

export type CardAssignmentVerdict =
  | { kind: "none" } // no assignment / no pump vehicle / same vehicle → nothing to say
  | { kind: "stale_assignment" } // pump-unit truck WAS at the station → card travels with it; fix the record
  | { kind: "unit_typo" } // ASSIGNED truck was at the station → card is with its truck; the pump unit was mis-keyed
  | { kind: "mismatch_confirmed" } // NEITHER truck was there → card away from both → strong misuse signal
  | { kind: "mismatch_unverified" }; // trucks differ but telematics can't place either → weak signal (combos only)

/**
 * Interpret "card assigned to truck A was used with pump unit B" using where each truck actually was
 * (WP1 D4 — the audit's stale-vs-fraud decision tree, automated). `pumpUnitAtStation` /
 * `assignedAtStation`: true = telematics placed the truck at the station, false = positively
 * elsewhere, null = unknown/no coverage. Precision-first: the strong verdict requires POSITIVE
 * evidence both trucks were elsewhere; unknowns yield the weak (corroboration-only) verdict. Pure.
 */
export function assessCardAssignment(input: {
  assignedVehicleId: string | null;
  pumpVehicleId: string | null;
  pumpUnitAtStation: boolean | null;
  assignedAtStation: boolean | null;
}): CardAssignmentVerdict {
  const { assignedVehicleId, pumpVehicleId, pumpUnitAtStation, assignedAtStation } = input;
  if (!assignedVehicleId || !pumpVehicleId || assignedVehicleId === pumpVehicleId) return { kind: "none" };
  if (pumpUnitAtStation === true) return { kind: "stale_assignment" };
  if (assignedAtStation === true) return { kind: "unit_typo" };
  if (pumpUnitAtStation === false && assignedAtStation === false) return { kind: "mismatch_confirmed" };
  return { kind: "mismatch_unverified" };
}
