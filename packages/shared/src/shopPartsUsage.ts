import type { UnitOfMeasure } from "./inventoryContract.js";
import type { UnitRosterKind } from "./unitShopContract.js";

/**
 * Shop parts by use — what the shop actually goes through (docs/plans/maintenance/SHOP-PARTS-USAGE-PLAN.md,
 * SP-U2). The figures are MEASURED in SQL (migration 0557: `shop_parts_list`, `shop_part_summary`,
 * `shop_part_history`); the one judgement made about them — "the same part came back to the same truck
 * soon" — is made here, once, so the API and the page cannot disagree about a threshold (D-SPU5).
 *
 * ── WHAT A NUMBER HERE MEANS ─────────────────────────────────────────────────────────────────────
 *   · a USE is one part on one FleetPal work order that was not canceled (D-SPU2);
 *   · `repairs` counts those work orders, `quantity` sums the lines;
 *   · its date is the repair's: completed, else started, else when the line was typed (D-SPU3).
 *
 * ── NO PRICES, BY RULING (D-SPU4, Q-SPU1) ────────────────────────────────────────────────────────
 * D-FP4: every surface printing FleetPal money also prints its coverage ratio, and a page that cannot
 * compute the ratio does not print the cost. A part's unit price is FleetPal money, so nothing here
 * carries one until the owner rules on Q-SPU1. Migration 0557 measures unit prices already; adding them
 * later is a field on these DTOs and a column, not a new read.
 */

/** The list's default window: "used in the last 90 days" (D-SPU1). */
export const PART_USAGE_WINDOW_DAYS = 90;

/**
 * Same part, same truck, again within this many days → the history row says so (D-SPU5, Q-SPU2).
 * A tire may legitimately go on the same trailer twice in a month (another wheel), so the words on
 * the page state the fact ("again after 12 days"), never a verdict about the repair.
 */
export const REPEAT_WITHIN_DAYS = 30;

/**
 * The list's sorts, in SQL's vocabulary (0557 refuses anything else with SPU01). 0557 can also sort by
 * `last_price`; it is not offered while prices are not shown (D-SPU4).
 */
export const PART_USAGE_SORTS = ["used", "repairs", "last_used", "part_number"] as const;
export type PartUsageSort = (typeof PART_USAGE_SORTS)[number];

/** Which parts the list shows: those used in the window (the default), or the whole catalogue. */
export const PART_USAGE_SHOW = ["used", "all"] as const;
export type PartUsageShow = (typeof PART_USAGE_SHOW)[number];

/** History rows per page on the part's page. */
export const PART_HISTORY_PAGE_SIZE = 25;

/** One catalogue part with its use — a row of the Shop parts list. */
export type PartUsageRowDto = {
  id: string;
  partNumber: string;
  description: string;
  unitOfMeasure: UnitOfMeasure;
  /** Null for a part typed here before F12; the page labels only those ("Added here", D-SPU6). */
  fleetpalId: string | null;
  /** Quantity used in the window — a sum of lines, may be fractional (feet, gallons). */
  usedQuantity: number;
  /** Work orders that used it in the window. */
  usedRepairs: number;
  /** The last repair that used it, ever — null for a part never used. ISO instant. */
  lastUsedAt: string | null;
};

export type PartUsageListDto = {
  rows: PartUsageRowDto[];
  total: number;
  windowDays: number;
};

/** One part's figures, for the part's page. */
export type PartUsageSummaryDto = {
  quantity90d: number;
  repairs90d: number;
  quantity365d: number;
  repairs365d: number;
  /** Trucks and trailers it went on in 12 months. */
  units365d: number;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
};

/** One repair that used the part — a row of "Where it went". */
export type PartUseDto = {
  workOrderNumber: number | null;
  /** FleetPal's word: OPEN, COMPLETED, CLOSED. */
  workOrderStatus: string | null;
  usedAt: string | null;
  /** OUR truck or trailer when FleetPal's unit is matched to one (D-FP7); null kind/id otherwise. */
  unit: { kind: UnitRosterKind | null; id: string | null; number: string | null };
  quantity: number;
  /** Days since the same part went on the same unit; null on its first time, or with no unit. */
  daysSincePreviousOnUnit: number | null;
};

export type PartUsageDetailDto = {
  summary: PartUsageSummaryDto;
  uses: PartUseDto[];
  total: number;
};

/** "Again after N days" — the same part back on the same unit within REPEAT_WITHIN_DAYS. */
export function isRepeatOnUnit(daysSincePrevious: number | null): boolean {
  return daysSincePrevious !== null && daysSincePrevious >= 0 && daysSincePrevious <= REPEAT_WITHIN_DAYS;
}
