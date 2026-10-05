/**
 * McLeod's hand-keyed fuel receipts on the IFTA "gallons bought" side (IFTA-PRECISION-PLAN IP6).
 *
 * ── WHAT A RECEIPT IS, AND WHY IT IS NOT A FILL ──────────────────────────────────────────────────
 * The office keys cash and drivers'-own-card fuel into McLeod's fuel-tax ledger as
 * `fuel_tax_history.source = 'F'` (§0.1): a tractor unit, a state, a date and gallons — no price, no
 * station, no time of day. That is exactly what an IFTA credit needs and nothing a card transaction
 * has, so a receipt joins the purchased side as its OWN source and never becomes a
 * `fuel_transactions` row (fraud scoring, MPG intervals and the spend report all assume a card).
 *
 * ── THE DUPLICATE RULE ───────────────────────────────────────────────────────────────────────────
 * 2 of 2026's 116 receipts are a fill the card had already imported, keyed again by hand: same
 * tractor, same state, same day, gallons within half a gallon. Counting both credits the same tax
 * twice. So a receipt that matches one of OUR card fills on all four is dropped — and each card fill
 * absorbs at most ONE receipt, because two receipts on one day for one truck are two fills unless
 * the card shows two. The day compared is the fill's station-local business date, the basis the
 * quarter itself is cut on (0247), and the receipt's own date, which has no time zone to convert.
 *
 * Pure and deterministic: the ledger and the state page each call it over their own candidate
 * fills, and because a match needs the same truck AND state, both see the same candidates for any
 * receipt — so the state page's gallons and the ledger row it opened from stay one figure.
 */

/** Gallons within which a hand-keyed receipt is the same fill as a card fill (§0.1, measured). */
export const RECEIPT_DUPLICATE_GALLON_TOLERANCE = 0.5;

/** One receipt as the ifta API returns it, already mapped to a truck where McLeod's unit is known. */
export interface IftaReceiptRaw {
  externalId: string;
  /** Null when McLeod's unit matches none of our trucks — counted in its state, never dropped. */
  vehicleId: string | null;
  /** McLeod's tractor unit, as keyed. */
  mcleodUnit: string;
  jurisdiction: string;
  /** The receipt's own date (no time of day exists). */
  receiptDate: string;
  gallons: number;
}

/** The four facts of a card fill the duplicate rule compares. */
export interface IftaCardFillKey {
  id: string;
  vehicleId: string | null;
  state: string | null;
  businessDate: string | null;
  gallons: number;
}

export interface ReceiptDuplicateSplit<R extends IftaReceiptRaw> {
  kept: R[];
  /** Receipts dropped because a card fill already carries the same gallons. */
  duplicates: R[];
}

const code = (s: string | null) => String(s ?? "").trim().toUpperCase();

/**
 * Splits receipts into those that add fuel and those a card fill already counted. Receipts are
 * matched in `externalId` order and each takes the closest-gallon unused fill, so the outcome does
 * not depend on the order either list arrived in. A receipt with no truck cannot be matched — there
 * is no "same tractor" to compare — and is kept.
 */
export function dropCardDuplicateReceipts<R extends IftaReceiptRaw>(
  receipts: readonly R[],
  cardFills: readonly IftaCardFillKey[],
): ReceiptDuplicateSplit<R> {
  const key = (vehicleId: string, state: string, day: string) => `${vehicleId}|${state}|${day}`;
  const candidates = new Map<string, IftaCardFillKey[]>();
  for (const f of cardFills) {
    if (!f.vehicleId || !f.businessDate || !code(f.state)) continue;
    const k = key(f.vehicleId, code(f.state), f.businessDate);
    candidates.set(k, [...(candidates.get(k) ?? []), f]);
  }

  const used = new Set<string>();
  const kept: R[] = [];
  const duplicates: R[] = [];
  const ordered = [...receipts].sort((a, b) => a.externalId.localeCompare(b.externalId));
  for (const r of ordered) {
    const pool = r.vehicleId ? (candidates.get(key(r.vehicleId, code(r.jurisdiction), r.receiptDate)) ?? []) : [];
    let best: IftaCardFillKey | null = null;
    for (const f of pool) {
      if (used.has(f.id)) continue;
      const d = Math.abs(f.gallons - r.gallons);
      if (d > RECEIPT_DUPLICATE_GALLON_TOLERANCE) continue;
      if (!best || d < Math.abs(best.gallons - r.gallons) || (d === Math.abs(best.gallons - r.gallons) && f.id < best.id)) best = f;
    }
    if (best) {
      used.add(best.id);
      duplicates.push(r);
    } else {
      kept.push(r);
    }
  }
  return { kept, duplicates };
}

/** Per jurisdiction, what the ledger adds to "gallons bought" from receipts. */
export interface IftaReceiptJurisdiction {
  jurisdiction: string;
  gallons: number;
  receipts: number;
}

/** The ledger's half of `GET /api/ifta/period`: receipts after the duplicate rule, by state. */
export interface IftaPeriodReceipts {
  jurisdictions: IftaReceiptJurisdiction[];
  /** Receipts dropped as duplicates of a card fill, and their gallons — said, never silent. */
  duplicatesDropped: number;
  duplicateGallons: number;
  /** Kept receipts whose McLeod unit matches none of our trucks, and those units. */
  unmatched: number;
  unmatchedUnits: string[];
}

/** Sums kept receipts per jurisdiction, unrounded — the position rounds once, with the card gallons. */
export function summarizePeriodReceipts(split: ReceiptDuplicateSplit<IftaReceiptRaw>): IftaPeriodReceipts {
  const by = new Map<string, IftaReceiptJurisdiction>();
  for (const r of split.kept) {
    const j = code(r.jurisdiction);
    const a = by.get(j) ?? { jurisdiction: j, gallons: 0, receipts: 0 };
    a.gallons += r.gallons;
    a.receipts += 1;
    by.set(j, a);
  }
  const unmatched = split.kept.filter((r) => r.vehicleId == null);
  return {
    jurisdictions: [...by.values()].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction)),
    duplicatesDropped: split.duplicates.length,
    duplicateGallons: split.duplicates.reduce((s, r) => s + r.gallons, 0),
    unmatched: unmatched.length,
    unmatchedUnits: [...new Set(unmatched.map((r) => r.mcleodUnit))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
  };
}
