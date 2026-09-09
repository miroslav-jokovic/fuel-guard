import { z } from "zod";
import { partDtoSchema, stockLineDtoSchema } from "./inventoryContract.js";
import { assetDtoSchema } from "./inventoryAssetContract.js";

/**
 * What a scan resolves to — the answer `GET /api/tags/resolve?code=` returns (D-INV7, plan I6).
 *
 * ── ONE SCAN, ONE ANSWER ────────────────────────────────────────────────────────────────────────
 * This union is the reason shop inventory and truck inventory are one plan. A technician holding a
 * phone does not know, and must not need to know, whether the code on the object in their hand
 * belongs to a stock line or an asset — they point the camera at a thing and the product tells them
 * what it is and what can be done to it. A separate "scan a part" and "scan an asset" mode would
 * push that classification back onto the person holding the phone, which is the one place it cannot
 * be answered.
 *
 * ── WHY THE FAILURES ARE MEMBERS AND NOT ERRORS ─────────────────────────────────────────────────
 * `unknown_tag` and `malformed` are ordinary results with ordinary HTTP 200s, because on a shop
 * floor they are ordinary events and each has a different useful next action. A well-formed tag
 * whose kind has no resolver is probably a label from a newer version of the product; a string that
 * is not a tag at all is a damaged label or a barcode from something else entirely. Returning 404
 * for both would collapse that difference into one dead end, and research §2.5 found that what the
 * good products do here is offer "attach or create" rather than a shrug — which requires knowing
 * which of the two happened, and keeping the scanned code to attach.
 *
 * Every member therefore carries `code`: the string as scanned, so the verb sheet can say "attach
 * this UPC to a part" and actually have the UPC.
 */

export const SCAN_RESULT_KINDS = [
  "stock_line",
  "asset",
  "part_by_upc",
  "unknown_tag",
  "malformed",
] as const;
export type ScanResultKind = (typeof SCAN_RESULT_KINDS)[number];

/** A `BIN` tag: one part at one location. The verb sheet leads with Issue (research §5.2). */
export const stockLineScanResultSchema = z.object({
  kind: z.literal("stock_line"),
  code: z.string(),
  stockLine: stockLineDtoSchema,
});

/** An `AST` tag. The sheet leads with Move, and shows where it is and since when. */
export const assetScanResultSchema = z.object({
  kind: z.literal("asset"),
  code: z.string(),
  asset: assetDtoSchema,
});

/**
 * Not one of ours, but a supplier barcode we recognise — the fall-through `parseTag` returning null
 * makes safe (§2.10: a UPC is digits, a tag starts with letters, so the two spaces cannot overlap).
 *
 * `stockLines` is where that part is held, which may be empty: knowing the part and knowing where
 * it sits are different lookups, and a part with no stock line anywhere is a real state the sheet
 * offers to fix.
 */
export const partByUpcScanResultSchema = z.object({
  kind: z.literal("part_by_upc"),
  code: z.string(),
  part: partDtoSchema,
  stockLines: z.array(stockLineDtoSchema),
});

/**
 * A well-formed `SIL1:` tag whose kind nothing has registered a resolver for. The distinction from
 * `malformed` is the point: this is structure we understand pointing at something we do not.
 */
export const unknownTagScanResultSchema = z.object({
  kind: z.literal("unknown_tag"),
  code: z.string(),
  tagKind: z.string().nullable(),
});

/** Not a tag and not a known UPC. The sheet offers "create a part / create an asset" with the code. */
export const malformedScanResultSchema = z.object({
  kind: z.literal("malformed"),
  code: z.string(),
});

export const scanResultSchema = z.discriminatedUnion("kind", [
  stockLineScanResultSchema,
  assetScanResultSchema,
  partByUpcScanResultSchema,
  unknownTagScanResultSchema,
  malformedScanResultSchema,
]);
export type ScanResult = z.infer<typeof scanResultSchema>;

export type StockLineScanResult = z.infer<typeof stockLineScanResultSchema>;
export type AssetScanResult = z.infer<typeof assetScanResultSchema>;
export type PartByUpcScanResult = z.infer<typeof partByUpcScanResultSchema>;
export type UnknownTagScanResult = z.infer<typeof unknownTagScanResultSchema>;
export type MalformedScanResult = z.infer<typeof malformedScanResultSchema>;

/**
 * Whether a scan landed on something the shop can act on. `false` is what puts the "attach or
 * create" sheet on screen rather than a verb list.
 */
export function isResolvedScan(result: ScanResult): boolean {
  return result.kind === "stock_line" || result.kind === "asset" || result.kind === "part_by_upc";
}
