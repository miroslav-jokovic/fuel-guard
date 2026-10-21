import { isVehiclePackaging, valueAtPath, valuesAgree, weightToLb, type ReviewEntry } from "@silvicom/shared";
import type { CalcLineForm } from "../calcModel";
import type { PrefillField, PrefillKey, PrefillLine } from "./bolPrefill";

/**
 * What a Calculate press must have from a person, and what it records about them (D-DR24, owner ruling
 * 2026-10-14; DOCUMENT-READER-PLAN §6 step 3.4).
 *
 * Until this file, Calculate sent whatever the form held: a count the two readers read as 6 and 9 went to
 * the engine as pass A's 6 behind a warning sentence, a BOL line the table refused was dropped from the
 * calculation in silence (`buildEngineLines` skips a line with no product), and no review was ever recorded
 * — so nobody could measure how often the reader is wrong. An external audit found it; the plan had asked
 * for it all along.
 *
 * Two rules:
 *   - **A disputed field stops Calculate** until a person acts on it: says it matches the page, picks one
 *     reading, or changes it. Disputed is read off the evidence, never restated — the readers disagree, only
 *     one reader read it, the row witness looked and did not find it, or the adapter gave a reason (a phrase it
 *     could not place, a table refusal). A filled line with no product stops it too: choose one or remove it.
 *   - **Every Calculate records a review** of each printed field the form carries as the paper printed it —
 *     the product's id, name, class and packing group, the package count, the gross weight — `confirmed` when
 *     the value sent is what pass A wrote, `corrected` otherwise, and `explicit` only when a person acted on
 *     that field. D-DR5 graduates on explicit rows alone, so a click-through teaches it nothing.
 *
 * Not recorded, on purpose: the package TYPE and Limited Quantity. The form holds the calculator's reading
 * of the printed packaging phrase and marks ("drum", a tick), not the print; writing "drum" against the path
 * that holds "20 STEEL DRUMS" would record a correction the reader never needed. Both are still disputed
 * fields above, so a person still acts on them before Calculate. A line the person deletes is not recorded
 * either — there is no value left to send — which leaves an invented line unlabelled; A6's labelled set
 * measures that instead.
 */

/** The fields a person acted on, per filled line: a tick, a picked reading, a change. */
export type Acted = ReadonlyMap<PrefillLine, ReadonlySet<PrefillKey>>;

/** Whether the evidence asks a person to look before this field reaches the engine. */
export function fieldNeedsAct(field: PrefillField): boolean {
  // A field neither reader read needs nothing: the two agree on nothing and nothing was filled — unless the
  // OCR row shows a value they both missed, which is worth a look. The paper's totals that no reading of the rows
  // fits (Q-DR26 L3) are worth a look too, on every weight they judged.
  return field.agree !== true || field.rowBacked === false || field.sumBacked === false || field.reason !== null;
}

/** The form's value of each filled field, to tell a person's change from the read's value. */
export const FORM_VALUE: Record<PrefillKey, (l: CalcLineForm) => unknown> = {
  product: (l) => l.product?.hmtRef ?? null,
  packageType: (l) => l.packageType,
  packageCount: (l) => l.packageCount.trim(),
  grossWeight: (l) => `${l.grossWeightValue.trim()} ${l.grossWeightUnit}`,
  limitedQuantity: (l) => l.isLimitedQuantity,
};

export const changedFrom = (prefill: PrefillLine, current: CalcLineForm, key: PrefillKey): boolean =>
  !valuesAgree(FORM_VALUE[key](current), FORM_VALUE[key](prefill.form));

/** Whether this field still waits on a person. */
export function fieldPending(prefill: PrefillLine, current: CalcLineForm, key: PrefillKey, acted: Acted): boolean {
  if (key === "product" && current.product === null) return true; // the line would be dropped unseen
  if (!fieldNeedsAct(prefill.fields[key])) return false;
  return !changedFrom(prefill, current, key) && !(acted.get(prefill)?.has(key) ?? false);
}

export interface FilledLine {
  prefill: PrefillLine;
  current: CalcLineForm;
}

/** How many filled fields still wait on a person — Calculate is disabled while any do. */
export function pendingCount(lines: readonly FilledLine[], acted: Acted): number {
  return lines.reduce(
    (n, { prefill, current }) => n + (Object.keys(prefill.fields) as PrefillKey[]).filter((k) => fieldPending(prefill, current, k, acted)).length,
    0,
  );
}

/**
 * The readings a person can pick for a count or weight the readers disagree on, as a one-click choice.
 * Only those two fields: the form holds them as printed, so a picked reading is exactly what is sent.
 */
export function readingChoices(field: PrefillField, key: PrefillKey): number[] {
  if ((key !== "packageCount" && key !== "grossWeight") || field.agree !== false) return [];
  const values = field.readings.flat().filter((v): v is number => typeof v === "number");
  return [...new Set(values)];
}

const norm = (v: unknown): string => String(v ?? "").toUpperCase().replace(/[\s-]+/g, "");
const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * What a person's act on a filled field says the PAGE prints, as a review path and value (Q-RC5) — recorded as the
 * act is made, so the paper audit takes it: the product's UN/NA number, the package count, the gross weight in
 * pounds. Null for the package type and Limited Quantity, which the form holds as the calculator's reading of the
 * print, not the print (see the header), and for a field the form holds nothing in.
 */
export function pageValueOf(prefill: PrefillLine, current: CalcLineForm, key: PrefillKey): { path: string; value: string | number } | null {
  const p = (k: string) => `hazmat.lines[${prefill.index}].${k}`;
  if (key === "product") return current.product ? { path: p("idText"), value: current.product.idLabel } : null;
  if (key === "packageCount") {
    const n = numOrNull(current.packageCount);
    return n === null ? null : { path: p("packageCount"), value: n };
  }
  if (key === "grossWeight") {
    const lb = weightToLb(numOrNull(current.grossWeightValue), current.grossWeightUnit);
    return lb === null ? null : { path: p("grossWeightLb"), value: lb };
  }
  return null;
}

/** One review batch for one Calculate press: every recordable path of every filled line still on the form. */
export function reviewEntries(result: unknown, lines: readonly FilledLine[], acted: Acted): Array<ReviewEntry> {
  const out: ReviewEntry[] = [];
  for (const { prefill, current } of lines) {
    const explicit = (key: PrefillKey) => changedFrom(prefill, current, key) || (acted.get(prefill)?.has(key) ?? false);
    const record = (path: string, sent: unknown, same: (old: unknown) => boolean, key: PrefillKey) => {
      const oldValue = (valueAtPath(result, path) ?? null) as ReviewEntry["oldValue"];
      const kept = same(oldValue);
      out.push({ path, action: kept ? "confirmed" : "corrected", oldValue, newValue: kept ? oldValue : (sent as ReviewEntry["newValue"]), explicit: explicit(key) });
    };
    const p = (k: string) => `hazmat.lines[${prefill.index}].${k}`;

    const product = current.product;
    if (product) {
      const sameProduct = !changedFrom(prefill, current, "product");
      const sent: Record<string, unknown> = { idText: product.idLabel, psn: product.psn, hazardClass: product.hazardClass, pg: product.pg };
      for (const [k, v] of Object.entries(sent)) {
        // The read's own product: pass A's text stands for itself — unless pass A wrote nothing there (a line
        // only pass B saw), which the calculation then corrected. A product the person chose: the printed
        // text is confirmed where the choice prints the same, corrected where it does not.
        // …but never the number: a product filled from pass B's reading (RC3, UN3264 where pass A read UN3254) is not
        // a confirmation of pass A's number — the review would label the misread as right (Q-RC5, found building it).
        const keepsA = k !== "idText" && sameProduct && prefill.form.product !== null;
        record(p(k), v, (old) => (keepsA && old !== null) || norm(old) === norm(v), "product");
      }
    }
    if (current.packageType !== "bulk_cargo" && !isVehiclePackaging(current.packageType)) {
      const count = numOrNull(current.packageCount);
      record(p("packageCount"), count, (old) => old === count, "packageCount");
    }
    const lb = weightToLb(numOrNull(current.grossWeightValue), current.grossWeightUnit);
    record(p("grossWeightLb"), lb, (old) => old === lb, "grossWeight");
  }
  return out;
}
