import type { ScanResult } from "@silvicom/shared";
import type { TagResolverContext } from "../../../tags/registry.js";
import { STOCK_COLUMNS, toStockLineDto } from "./stock.js";
import { ASSET_COLUMNS, toAssetDto, type AssetRow } from "./assets.js";

/**
 * What a `BIN` or an `AST` tag resolves to (D-INV7; INVENTORY-PLAN.md step I6, the fabric half).
 *
 * ── THE RESOLVERS LIVE WITH THE TABLES, NOT WITH THE ROUTE ────────────────────────────────────
 * `apps/api/src/tags/` knows how to dispatch a kind; this file knows what a maintenance tag means.
 * The split is what lets §2.10's future kinds — a vehicle, an inspection, a DQ document — each
 * arrive as a resolver in their own module without any of them touching the others.
 *
 * ── NULL IS A REAL ANSWER ─────────────────────────────────────────────────────────────────────
 * A well-formed tag whose id belongs to no row in THIS org resolves to null, and the route reports
 * it as `unknown_tag`. It is deliberately indistinguishable from "another org's tag": a resolver
 * that answered differently for a code that exists elsewhere would confirm the existence of another
 * tenant's label to anyone holding a phone.
 */

/**
 * ⚠ Both column lists are IMPORTED from the readers that own them, never restated here. A tag
 * resolver reading a narrower selection would hand the screen a DTO with holes that the same row
 * fetched from the list page does not have — and the scan sheet and the detail page would disagree
 * about the same object.
 */
export async function resolveBinTag(ctx: TagResolverContext): Promise<ScanResult | null> {
  const { data, error } = await ctx.admin
    .from("part_stock")
    .select(STOCK_COLUMNS)
    .eq("org_id", ctx.orgId)
    .eq("tag_code", ctx.id)
    .maybeSingle();
  if (error || !data) return null;
  return { kind: "stock_line", code: ctx.code, stockLine: toStockLineDto(data as never) };
}

export async function resolveAssetTag(ctx: TagResolverContext): Promise<ScanResult | null> {
  const { data, error } = await ctx.admin
    .from("inventory_assets")
    .select(ASSET_COLUMNS)
    .eq("org_id", ctx.orgId)
    .eq("tag_code", ctx.id)
    .maybeSingle();
  if (error || !data) return null;
  /**
   * ⚠ No driver name and no "since when" on a scan.
   *
   * Both are extra round trips, and a scan is the one read in the product where latency is the
   * feature — the sheet has to be on screen before the technician's thumb has left the trigger.
   * `AssetDto` marks both nullable, the verb sheet leads with Move and the asset's own page is one
   * tap away with the full answer.
   */
  return { kind: "asset", code: ctx.code, asset: toAssetDto(data as unknown as AssetRow) };
}
