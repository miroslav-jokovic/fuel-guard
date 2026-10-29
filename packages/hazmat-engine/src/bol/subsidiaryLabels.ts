/**
 * Whether a package must bear a subsidiary hazard label — §172.402, as far as the table and the caller can tell
 * (PLACARD-CALCULATOR-RELIABILITY-PLAN Q-PC6 (a), ruled 2026-10-29; TWO-CLICK-READER-PLAN TC1.3).
 *
 * It matters to the paper because §172.202(a)(3) lets the shipper leave a subsidiary class off: "The subsidiary hazard
 * class or division number is not required to be entered when a corresponding subsidiary hazard label is not
 * required" (PHMSA 22-0041, 25-0057). So "3" for a 3 (8) material is lawful on a placarded IBC and a defect on a drum.
 *
 *   - Which labels: column (6) of the line's OWN packing-group row (§172.402(a)(1)) — `subsidiaryLabels`, derived by
 *     @hazmat/data from the label codes. Column (6) differs by row (UN1287: PG II labelled 3, PG III none).
 *   - Bulk: §172.400(a) labels non-bulk packages, and bulk packagings other than tanks only "unless placarded in
 *     accordance with subpart F". A bulk packaging placards at any quantity (§172.504(c)), so its labels are not
 *     required — except a Class 9 one, whose placard §172.504(f)(9) waives: that one is `unknown`.
 *   - §172.402(a)(2)'s "*": a subsidiary 3 in PG III is "required for all modes, except for a material with a flash point
 *     at or above 38 °C (100 °F) transported by rail or highway" — the flash point is the shipper's to know: `unknown`.
 *   - §172.400a(c): a Class 8 material's 6.1 subsidiary label is not required when its toxicity is "based solely on the
 *     corrosive destruction of tissue rather than systemic poisoning" — again the shipper's: `unknown`.
 *   - A Limited Quantity claim, or packaging the caller could not tell: `unknown`.
 * `unknown` is never called wrong (Q-PC6 (a): a defect only where the label IS required); it is recorded in the facts.
 */
export type LabelNeed = "required" | "not_required" | "unknown";

export interface LabelRow { pg: "I" | "II" | "III" | null; subsidiaryLabels?: string[] }

export function subsidiaryLabelNeed(input: {
  primary: string;
  code: string;
  pg: "I" | "II" | "III" | null;
  packagingKind: "bulk" | "non_bulk" | null | undefined;
  limitedQuantity: boolean | null | undefined;
}): { need: LabelNeed; because: string } {
  const { primary, code, pg, packagingKind } = input;
  if (input.limitedQuantity) return { need: "unknown", because: "limited_quantity_claimed" };
  if (packagingKind == null) return { need: "unknown", because: "packaging_unknown" };
  if (packagingKind === "bulk") return primary === "9" ? { need: "unknown", because: "bulk_class_9_unplacarded" } : { need: "not_required", because: "bulk_placarded" };
  if (code === "3" && pg === "III") return { need: "unknown", because: "flash_point_172_402_a_2" };
  if (code === "6.1" && primary === "8") return { need: "unknown", because: "corrosive_toxicity_172_400a_c" };
  return { need: "required", because: "column_6" };
}

/** The classes a printed class cell names — "3 (8)", "8(6.1)", "3, 8" → ["3", "8"]. */
export function printedClasses(text: string | null | undefined): string[] {
  return [...(text ?? "").matchAll(/(?<![\d.])([1-9](?:\.[1-6])?)(?!\d)/g)].map((m) => m[1]!);
}
