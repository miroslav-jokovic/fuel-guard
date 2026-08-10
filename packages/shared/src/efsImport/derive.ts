/**
 * The EFS repair path: derive fuel events from lines already stored verbatim in `efs_transactions`.
 *
 * Split out of parse.ts, which sat at 499 lines against a 500-line budget — one line of headroom, so
 * the first real addition (the currency guard, Stage 3) broke the gate. That is the budget behaving
 * as a target rather than a ceiling; the fix is a module boundary, not a grandfather entry.
 *
 * This is a genuinely separate concern from parsing an uploaded file: it re-derives scoreable fuel
 * events from stored rows, which is what runs when an import is repaired or replayed. It carries the
 * same currency guard as the import path deliberately — a row rejected at import must not walk back
 * in through re-derivation.
 */
import { fuelTypeFromText } from "./parse.js";
import { nonUsdGallonsReason } from "./currency.js";
import { FUEL_PRODUCT_CODES, tankTypeForItem, fuelEventDateKey } from "./types.js";
import type { EfsStoreLine, DerivedFuelEvents } from "./parse.js";
import type { ParsedFuelLine } from "./types.js";
import { str, isNoonSentinelIso } from "./dateTime.js";

/**
 * Re-derive merged fuel events from faithful EFS store lines. Produces the SAME external_ref, merge
 * and precision semantics as `normalizeTransactionRows` on the original file (one event per
 * card|invoice|business-date; gallons/cost summed; price re-derived from the merged totals).
 */
export function deriveFuelEventsFromEfsStore(lines: EfsStoreLine[]): DerivedFuelEvents {
  const byKey = new Map<string, ParsedFuelLine>();
  let skippedNonFuel = 0;
  let skippedBlankInvoice = 0;
  let skippedUnusable = 0;
  let skippedNonUsd = 0;

  for (const l of lines) {
    const item = (str(l.item) ?? "").toUpperCase();
    const fuelType = FUEL_PRODUCT_CODES[item] ?? fuelTypeFromText(item);
    if (!fuelType) {
      skippedNonFuel += 1;
      continue;
    }
    if (l.tran_date == null || l.qty == null || l.qty <= 0 || l.fueled_at == null) {
      skippedUnusable += 1;
      continue;
    }
    // Same fail-closed guard as the direct parser: qty is about to become gallons and amt dollars.
    if (nonUsdGallonsReason(l.currency) != null) {
      skippedNonUsd += 1;
      continue;
    }
    const invoice = str(l.invoice);
    const txnId = str(l.transaction_id);
    // Skip only when there is NEITHER a transaction id NOR an invoice to key on (the direct parser keeps
    // anything with either). Keying on invoice alone here — instead of the shared builder — is what let
    // this path mint an invoice-ref twin of every transactionId-ref fill the direct parser had stored.
    if (!invoice && !txnId) {
      skippedBlankInvoice += 1;
      continue;
    }
    const dateKey = fuelEventDateKey({
      card: str(l.card_num),
      identity: txnId,
      invoice,
      fallback: `${l.fueled_at ?? ""}|${l.amt ?? ""}|${l.qty}`,
      tranDate: l.tran_date,
    });
    const tankType = tankTypeForItem(item);
    const ref = tankType === "reefer" ? `${dateKey}|reefer` : dateKey;
    const key = `${dateKey}|${tankType}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.gallons += l.qty;
      existing.total_cost = (existing.total_cost ?? 0) + (l.amt ?? 0);
      // Keep the earliest instant in the group as the fueling time.
      if (new Date(l.fueled_at).getTime() < new Date(existing.fueled_at).getTime()) {
        existing.fueled_at = l.fueled_at;
      }
    } else {
      byKey.set(key, {
        external_ref: ref,
        transaction_id: str(l.transaction_id),
        unit: str(l.unit),
        driver_name: str(l.driver_name),
        card_ref: str(l.card_num),
        control_id: str(l.control_id),
        driver_ext_id: str(l.driver_ext_id),
        fueled_at: l.fueled_at,
        tran_date: l.tran_date,
        fueled_at_precision: isNoonSentinelIso(l.fueled_at) ? "date" : "instant",
        odometer: l.odometer,
        gallons: l.qty,
        price_per_gal: null, // re-derived from merged totals below
        total_cost: l.amt,
        fuel_type: fuelType,
        tank_type: tankType,
        item,
        location_text: str(l.location_name),
        city: str(l.city),
        state: str(l.state),
      });
    }
  }

  const events = [...byKey.values()].map((e) => ({
    ...e,
    price_per_gal:
      e.total_cost != null && e.gallons > 0
        ? Math.round((e.total_cost / e.gallons) * 1000) / 1000
        : e.price_per_gal,
  }));

  return { events, skippedNonFuel, skippedBlankInvoice, skippedUnusable, skippedNonUsd };
}
