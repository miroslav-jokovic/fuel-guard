/**
 * CARD → TRUCK ASSIGNMENT (WP1 D4/D5) — populate and use `fuel_cards` as the card→vehicle ground truth.
 *
 * The standard EFS reject export does NOT carry the card-assigned truck (verified: 15 columns, no
 * Truck field), so the assignment must be learned on our side from approved-fill history and kept in
 * `fuel_cards`. Pure logic lives here (identity key, learner, mismatch assessment); the API service
 * does the queries/upserts.
 */

/** Digits-only view of a string (EFS pads refs with trailing spaces). */
const digits = (s: string | null | undefined): string => (s ?? "").replace(/\D/g, "");

/** A card number this long (unmasked) is a full PAN and identifies the card on its own. */
export const FULL_PAN_MIN_DIGITS = 8;

/**
 * Mask detection (WP3c). EFS reports now truncate the PAN, and the masking is NOT always a bare
 * last-4: refs arrive as `1234`, `****1234`, `••••1234` and `708305XXXXXX1234`. The last form is the
 * dangerous one — a naive digits-only view yields `7083051234` (10 digits), which the old ≥8-digit
 * test read as a FULL PAN, so the control id was never consulted and every card sharing a BIN prefix
 * + last-4 was conflated into one identity. `x` counts as a mask character only when the ref carries
 * no other letters (so a genuinely alphanumeric fleet ref like "TX1234" is left alone).
 */
const UNAMBIGUOUS_MASK = /[*•·#]/;
const NON_X_LETTER = /[a-wyz]/i;

function maskSplitter(ref: string): RegExp | null {
  if (UNAMBIGUOUS_MASK.test(ref)) return /[*•·#xX]+/g;
  if (/x/i.test(ref) && !NON_X_LETTER.test(ref)) return /[xX]+/g;
  return null;
}

/** True when the ref is masked/truncated — only its trailing digits are the card's own. */
export function isMaskedCardRef(cardRef: string | null | undefined): boolean {
  return maskSplitter((cardRef ?? "").trim()) != null;
}

/**
 * The digits of a ref that really belong to the card. For a masked ref that is ONLY the trailing run
 * after the last mask character (`708305XXXXXX1234` → `1234`); for an unmasked ref it is every digit.
 * This is what every identity comparison must be built on. Pure.
 */
export function cardDigits(cardRef: string | null | undefined): string {
  const s = (cardRef ?? "").trim();
  if (!s) return "";
  const splitter = maskSplitter(s);
  if (!splitter) return digits(s);
  const parts = s.split(splitter);
  return digits(parts[parts.length - 1] ?? "");
}

/**
 * True when the ref is an UNMASKED full card number — the only case where the ref alone identifies
 * one physical card. A masked ref is never full, however many digits survive the mask.
 */
export function isFullCardNumber(cardRef: string | null | undefined): boolean {
  const s = (cardRef ?? "").trim();
  if (!s || maskSplitter(s)) return false;
  return digits(s).length >= FULL_PAN_MIN_DIGITS;
}

/**
 * Stable identity key for one physical card. Full unmasked PAN when the export carries it; else
 * last4 + the EFS Driver Control ID (migration 0075: EFS masks cards to the last 4, which collides
 * across drivers — the control id disambiguates). Returns null when the row can't identify a card
 * reliably (masked/short ref with no control id) — callers must stay silent rather than guess.
 *
 * The masked key is keyed on the LAST 4 (not on every surviving digit) so `1234`, `****1234` and
 * `708305XXXXXX1234` collapse to ONE identity for the same card + control id.
 */
export function cardIdentityKey(cardRef: string | null | undefined, controlId?: string | null): string | null {
  if (isFullCardNumber(cardRef)) return digits(cardRef);
  const l4 = cardLast4(cardRef);
  const ctrl = controlId?.trim();
  return l4 && ctrl ? `${l4}|${ctrl}` : null;
}

/** Convenience predicate: can this row identify a physical card at all? */
export function cardIsIdentifiable(cardRef: string | null | undefined, controlId?: string | null): boolean {
  return cardIdentityKey(cardRef, controlId) != null;
}

/** Last 4 digits of a card ref (for the fuel_cards.card_last4 lookup path), or null. Mask-aware. */
export function cardLast4(cardRef: string | null | undefined): string | null {
  const d = cardDigits(cardRef);
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
 * Are two card refs COMPATIBLE — i.e. could they be the same physical card? Handles EFS's mixed
 * formats (F5): full PAN on one report, masked last-4 on the other, padding/whitespace. True when the
 * card-owned digit strings are equal OR one (≥4 digits) is the trailing suffix of the other.
 *
 * ⚠️ This is a COMPATIBILITY test, not an identity test. Two different drivers' cards sharing a last-4
 * are "compatible" and this returns true for them. Anything that decides "these two rows are the SAME
 * card" must use `sameCardFill` (or compare `cardIdentityKey`s) instead. Pure.
 */
export function cardRefsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = cardDigits(a);
  const db = cardDigits(b);
  if (da.length < 4 || db.length < 4) return false;
  if (da === db) return true;
  const [short, long] = da.length <= db.length ? [da, db] : [db, da];
  return long.endsWith(short);
}

/**
 * Do two refs identify the same card WITHOUT any help from a control id? Only true when BOTH sides
 * are unmasked full card numbers and their digits are equal. Used where no control id exists at all
 * (the decline reports), so those paths can stay silent instead of guessing on a last-4.
 */
export function cardRefsDefinitelyMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return isFullCardNumber(a) && isFullCardNumber(b) && digits(a) === digits(b);
}

/**
 * Dominant vehicle among ONE card's fills (WP3b — the as-of-fill-time assignment). Same evidence bar
 * as learnCardAssignments (≥ minFills attributed fills, ≥ minShare majority) applied to a caller-scoped
 * row set — the scorer passes the 60 days BEFORE the fill being scored, so a rebuild judges each fill
 * against the assignment that was true THEN, never against today's. Returns null without real evidence
 * (floating/slip-seat card, era change in progress). Pure.
 */
export function dominantVehicle(
  vehicleIds: (string | null)[],
  opts: { minFills?: number; minShare?: number } = {},
): string | null {
  const minFills = opts.minFills ?? 5;
  const minShare = opts.minShare ?? 0.7;
  const attributed = vehicleIds.filter((v): v is string => !!v);
  if (attributed.length < minFills) return null;
  const counts = new Map<string, number>();
  for (const v of attributed) counts.set(v, (counts.get(v) ?? 0) + 1);
  let winner: string | null = null;
  let win = 0;
  for (const [v, c] of counts) if (c > win) { win = c; winner = v; }
  return winner && win / attributed.length >= minShare ? winner : null;
}

/**
 * Are two FILL rows the same physical card? (WP3 — the card_multi_vehicle identity test, corrected in
 * WP3c.) Symmetric, and it NEVER short-circuits past the control id on a masked ref:
 *
 *   • both sides unmasked full card numbers → the digits decide, control not needed;
 *   • otherwise (either side masked or a bare last-4) the ref alone cannot identify a card, so the
 *     last 4 must agree AND both control ids must be present and equal.
 *
 * The old rule accepted "one side has ≥8 digits" as definitive. That was wrong twice over: a masked
 * ref like `708305XXXXXX1234` has ≥8 digits but is not a PAN, and a genuine PAN compared against a
 * bare last-4 is a suffix match shared by every card ending in those digits — which is exactly how a
 * single fill collected other drivers' trucks and fired `card_multi_vehicle`.
 *
 * Deliberately asymmetric in its failure mode: an unresolvable pair returns FALSE (the card's own
 * history goes uncounted) rather than TRUE (another driver's fill gets counted as this card's). An
 * undercount costs recall on an unidentifiable card; an overcount fabricates a high-severity alert.
 * Pure.
 */
export function sameCardFill(
  a: { cardRef: string | null; controlId: string | null },
  b: { cardRef: string | null; controlId: string | null },
): boolean {
  const da = cardDigits(a.cardRef);
  const db = cardDigits(b.cardRef);
  if (da.length < 4 || db.length < 4) return false;
  if (isFullCardNumber(a.cardRef) && isFullCardNumber(b.cardRef)) return da === db;
  if (da.slice(-4) !== db.slice(-4)) return false;
  const ca = a.controlId?.trim();
  const cb = b.controlId?.trim();
  return !!ca && !!cb && ca === cb;
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
