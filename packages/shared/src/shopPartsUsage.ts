import type { UnitOfMeasure } from "./inventoryContract.js";
import type { UnitRosterKind } from "./unitShopContract.js";

/**
 * Shop parts by use — what the shop actually goes through (docs/plans/maintenance/SHOP-PARTS-USAGE-PLAN.md,
 * SP-U2). The figures are MEASURED in SQL (migration 0557: `shop_parts_list`, `shop_part_summary`,
 * `shop_part_history`); every judgement made about them — "the same part came back to the same truck
 * soon", "a typical price", "well above usual" — is made here, once, so the API and the page cannot
 * disagree about a threshold (D-SPU5).
 *
 * ── WHAT A NUMBER HERE MEANS ─────────────────────────────────────────────────────────────────────
 *   · a USE is one part on one FleetPal work order that was not canceled (D-SPU2);
 *   · `repairs` counts those work orders, `quantity` sums the lines;
 *   · its date is the repair's: completed, else started, else when the line was typed (D-SPU3).
 *
 *   · a price is a UNIT price, never a total of money; a credit (price ≤ 0) counts in quantity, never in
 *     a price (0557).
 *
 * ── PRICES ARE SHOWN, SUMS ARE NOT (D-SPU10, owner 2026-11-03) ───────────────────────────────────
 * Q-SPU1 asked whether a part's unit price may show without D-FP4's coverage ratio; the owner answered
 * "we can show everything". D-FP4's concern is a FleetPal TOTAL read as the maintenance bill; a unit
 * price ("$43.12 a kit") cannot be read that way, so this surface shows unit prices to everyone who can
 * open it, and still sums no money.
 */

/** The list's default window: "used in the last 90 days" (D-SPU1). */
export const PART_USAGE_WINDOW_DAYS = 90;

/**
 * Same part, same truck, again within this many days → the history row says so (D-SPU5, Q-SPU2).
 * A tire may legitimately go on the same trailer twice in a month (another wheel), so the words on
 * the page state the fact ("again after 12 days"), never a verdict about the repair.
 */
export const REPEAT_WITHIN_DAYS = 30;

/** A "typical" price needs at least this many priced repairs behind it; fewer is an anecdote. */
export const TYPICAL_PRICE_MIN_REPAIRS = 5;

/** A repair's unit price at or above typical × this reads "well above usual". */
export const PRICE_WELL_ABOVE_RATIO = 1.5;

/** The list's sorts, in SQL's vocabulary (0557 refuses anything else with SPU01). */
export const PART_USAGE_SORTS = ["used", "repairs", "last_used", "last_price", "part_number"] as const;
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
  /** Unit price on the latest PRICED repair, ever — null when no repair priced it. */
  lastPrice: number | null;
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
  lastPrice: number | null;
  /** 12-month median unit price — null when fewer than TYPICAL_PRICE_MIN_REPAIRS priced repairs. */
  typicalPrice: number | null;
  lowPrice365d: number | null;
  highPrice365d: number | null;
  pricedRepairs365d: number;
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
  /** Unit price on this repair; null when unpriced yet, or only a credit. */
  unitPrice: number | null;
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

/**
 * The typical price, only when enough repairs stand behind it. The SQL median is returned whatever it
 * stands on; this is where "two repairs are not a typical price" is decided.
 */
export function typicalPriceOf(median: number | null, pricedRepairs: number): number | null {
  return median !== null && pricedRepairs >= TYPICAL_PRICE_MIN_REPAIRS ? median : null;
}

/** True when a repair's unit price is well above the part's typical price. */
export function isPriceWellAbove(unitPrice: number | null, typical: number | null): boolean {
  if (unitPrice === null || typical === null || typical <= 0) return false;
  return unitPrice >= typical * PRICE_WELL_ABOVE_RATIO;
}
