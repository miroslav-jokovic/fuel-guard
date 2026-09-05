import { EFS_REJECT_TZ, zonedWallTimeToUtcIso } from "../efsImport/index.js";
import { exclusiveEndYmd } from "../calendarDay.js";

/**
 * The Fuel Log's three lists, and exactly what narrows them (FUEL-P2, D-FUI15).
 *
 * ── WHY THESE LIVE IN SHARED AND NOT BESIDE THE SCREEN THAT USES THEM ───────────────────────────
 * P2 gives every fuel list a scoped export, and D-FUI15 fixes its shape: server-rendered from the
 * SAME pure functions the screen uses, so the file and the page cannot disagree. There is exactly one
 * way to honour that sentence — the filters have to have one definition that both layers call.
 *
 * The alternative was writing them a second time in the API. That is the drift `fuelSpendReport.ts`
 * carries a scar about and the reason `useEfsData`'s own header refused a second SQL function for the
 * attribution count: two implementations of "the rows on screen" disagree the first time somebody
 * changes one, and the disagreement surfaces as an export a controller quotes in a dispute.
 *
 * ── HOW THIS STAYS PURE ────────────────────────────────────────────────────────────────────────
 * `PostgrestFilterable` is STRUCTURAL. This package may not depend on `@supabase/supabase-js` (it is
 * compiled for React Native and has no workspace deps), and it does not need to: PostgREST's builder
 * is a chain of methods that return the builder, so naming the seven methods these filters reach for
 * is narrower and more honest than `any`, and it fails to compile if that chaining ever stops.
 *
 * Both callers pass a real `PostgrestFilterBuilder` — the browser's anon client and the API's
 * service-role client. ⚠ The service role BYPASSES RLS, so an API caller must add its own
 * `.eq("org_id", …)` before or after these; nothing here is a tenant boundary and nothing here
 * pretends to be.
 */

/** The builder methods these filters reach for. Structural, so this file imports no vendor SDK. */
export interface PostgrestFilterable {
  eq(column: string, value: unknown): PostgrestFilterable;
  in(column: string, values: readonly unknown[]): PostgrestFilterable;
  gte(column: string, value: unknown): PostgrestFilterable;
  lte(column: string, value: unknown): PostgrestFilterable;
  lt(column: string, value: unknown): PostgrestFilterable;
  or(filters: string): PostgrestFilterable;
}

/** What narrows the two RAW EFS lists — Source records and Declines. */
export interface EfsListFilters {
  /** Unit numbers to narrow to. Empty or absent means every unit — never "no units" (FUEL-P1). */
  units?: string[];
  /** Window start, inclusive, `YYYY-MM-DD`. */
  from?: string;
  /** Window end, inclusive, `YYYY-MM-DD`. */
  to?: string;
  /** Free text (driver / location / item or error). */
  search?: string;
  /** Declines only: `clear | review | alert`. */
  suspicion?: string;
  /** Source records only: the product (ULSD, DEF, …). */
  item?: string;
  state?: string;
  /** Exact `driver_name` — a NAME on both raw feeds, unlike the fills tab's driver id. */
  driver?: string;
  /** Declines only. */
  errorCode?: string;
  /** Declines only: `policy_name`. */
  policy?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
}

/** What narrows the enriched fill list — the Fills tab. */
export interface FuelLogFilters {
  /**
   * Vehicle ids to narrow to (FUEL-P1).
   *
   * ⚠ Three states, and the middle one is the point: `undefined` is the whole fleet, a non-empty list
   * is those trucks, and an EMPTY list is "none of them" — which is what a filter naming units this
   * fleet does not have resolves to. Collapsing empty into undefined shows every truck's fills under a
   * filter bar naming two.
   */
  vehicleIds?: string[];
  driverId?: string;
  /**
   * The window, as CALENDAR DAYS — both ends inclusive, both `YYYY-MM-DD`, and both meaning the
   * STATION-LOCAL business date (D-FUI11, migration 0287). Not an instant, and deliberately not one.
   */
  from?: string;
  to?: string;
  tankType?: "tractor" | "reefer";
  /** Free-text smart search, matched against location and card plus the id lists below. */
  search?: string;
  /** Vehicle ids whose unit matched `search` — resolved by the caller against the fleet. */
  searchVehicleIds?: string[];
  /** Driver ids whose name matched `search`. */
  searchDriverIds?: string[];
  sortKey?: string;
  sortDir?: "asc" | "desc";
}

/**
 * The free-text term, sanitised ONCE, for every caller.
 *
 * `%,()` are stripped because PostgREST's `.or(...)` grammar is comma- and paren-delimited and treats
 * `%` as a wildcard — an unstripped term is a syntax error or a filter that matches the whole fleet.
 * `fuel_range_totals` does not need the strip (0289 escapes the term server-side), but it must be
 * given the SAME term anyway: the tiles sit directly above the table, and a tile counting a different
 * set than the rows beneath it is precisely the disagreement FUEL-T3a exists to end. One sanitiser,
 * one term, every caller — now including the export.
 */
export function fuelSearchTerm(f: { search?: string }): string | null {
  if (!f.search) return null;
  const t = f.search.replace(/[%,()]/g, "").trim();
  return t || null;
}

const ilikeOr = (term: string, cols: string[]): string =>
  cols.map((c) => `${c}.ilike.%${term.replace(/[%,()]/g, "")}%`).join(",");

/**
 * The UTC instants that bound a range of EFS REJECT business days (FUEL-T1, D-FUI11).
 *
 * ── WHY DECLINES GET A COMPUTED WINDOW AND FILLS GOT A STORED COLUMN ────────────────────────────
 * A fill's day depends on WHERE it happened — the station's state — so it varies row by row and cannot
 * be expressed as one instant range. That is why `fuel_transactions` needed a stored,
 * trigger-maintained `business_date` (migration 0287).
 *
 * A decline's day does not vary: EFS documents reject times in CENTRAL regardless of where the station
 * is (the guide's own words, and the reason the page renders them with a "CT" label). One fixed zone
 * makes the whole window a pure computation, so declines need no column, no migration and no backfill
 * — deriving beats storing when the derivation is constant.
 *
 * Returns a half-open range: `gte` is the first instant of `fromDay` in Central, `lt` the first instant
 * of the day AFTER `toDay`. Half-open rather than an inclusive `lte` because "the last moment of a day"
 * has no exact representation — `23:59:59` silently drops the final second.
 */
export function efsRejectDayWindow(fromDay: string, toDay: string): { gte: string; lt: string } {
  return {
    gte: zonedWallTimeToUtcIso(fromDay.slice(0, 10), "00:00:00", EFS_REJECT_TZ),
    lt: zonedWallTimeToUtcIso(exclusiveEndYmd(toDay), "00:00:00", EFS_REJECT_TZ),
  };
}

/**
 * Every `efs_transactions` filter, applied once, for every caller.
 *
 * Three callers now: the list, the FUEL-T5 attribution count beside it, and P2's export. The only way
 * any of them can be wrong is by describing a different set than the others.
 */
export function applyEfsTxnFilters<Q>(query: Q, f: EfsListFilters): Q {
  let q = query as unknown as PostgrestFilterable;
  // FUEL-P1. `.in()` over a LIST, and only when the list has something in it: an empty selection is
  // "every unit", while `.in("unit", [])` is "no unit at all". PostgREST renders the latter as
  // `unit=in.()` and returns nothing (verified against the hosted API, 2026-09-04), which is right for
  // a filter naming units that do not exist and very wrong for a filter naming none.
  if (f.units?.length) q = q.in("unit", f.units);
  if (f.item) q = q.eq("item", f.item);
  if (f.state) q = q.eq("state", f.state);
  if (f.driver) q = q.eq("driver_name", f.driver);
  if (f.from) q = q.gte("tran_date", f.from);
  if (f.to) q = q.lte("tran_date", f.to);
  if (f.search) q = q.or(ilikeOr(f.search, ["unit", "driver_name", "card_num", "invoice", "location_name", "item", "city"]));
  return q as unknown as Q;
}

/** Every `declined_transactions` filter, applied once, for every caller. See `applyEfsTxnFilters`. */
export function applyDeclinedFilters<Q>(query: Q, f: EfsListFilters): Q {
  let q = query as unknown as PostgrestFilterable;
  if (f.units?.length) q = q.in("unit", f.units);
  if (f.suspicion) q = q.eq("suspicion_level", f.suspicion);
  if (f.errorCode) q = q.eq("error_code", f.errorCode);
  if (f.state) q = q.eq("state", f.state);
  if (f.driver) q = q.eq("driver_name", f.driver);
  if (f.policy) q = q.eq("policy_name", f.policy);
  // FUEL-T1 / D-FUI11. `declined_at` is a correct UTC instant and the page renders it in CENTRAL,
  // so filtering the raw instant against bare date strings asked a UTC question of a Central answer:
  // a decline at 19:00 CT on 31 August is 2026-09-01T00:00Z and fell outside an August window while
  // the row above it read "Aug 31".
  if (f.from && f.to) {
    const w = efsRejectDayWindow(f.from, f.to);
    q = q.gte("declined_at", w.gte).lt("declined_at", w.lt);
  } else if (f.from) {
    q = q.gte("declined_at", efsRejectDayWindow(f.from, f.from).gte);
  } else if (f.to) {
    q = q.lt("declined_at", efsRejectDayWindow(f.to, f.to).lt);
  }
  if (f.search) {
    const t = f.search.replace(/[%,()]/g, "");
    q = q.or(
      [`unit.ilike.${t}%`, `driver_name.ilike.%${t}%`, `location_text.ilike.%${t}%`, `city.ilike.%${t}%`, `error_description.ilike.%${t}%`].join(","),
    );
  }
  return q as unknown as Q;
}

/**
 * Every `fuel_transactions` filter the Fuel Log's Fills tab applies.
 *
 * ⚠ `is_canonical` is NOT here, and that is deliberate rather than an omission: it is what makes a row
 * a fill at all rather than a duplicate, so it belongs to the query's identity and not to the reader's
 * filters. Both callers state it themselves, immediately, where it reads as part of "which rows are
 * we talking about".
 */
export function applyFuelLogFilters<Q>(query: Q, f: FuelLogFilters): Q {
  let q = query as unknown as PostgrestFilterable;
  if (f.vehicleIds) q = q.in("vehicle_id", f.vehicleIds);
  if (f.driverId) q = q.eq("driver_id", f.driverId);
  if (f.tankType) q = q.eq("tank_type", f.tankType);
  // FUEL-T1 / D-FUI11. The stored station-local day (0287), so the filter and the display read the
  // same derivation instead of agreeing by luck: 1,833 of 14,749 fills disagreed, 57 of them
  // ($28,430.70) landing in the neighbouring MONTH's total.
  if (f.from) q = q.gte("business_date", f.from);
  if (f.to) q = q.lte("business_date", f.to);
  const or = fuelLogSearchOr(f);
  if (or) q = q.or(or);
  return q as unknown as Q;
}

/** The `.or(...)` term for the fills smart search across location/card plus the resolved id lists. */
export function fuelLogSearchOr(f: FuelLogFilters): string | null {
  const t = fuelSearchTerm(f);
  if (!t) return null;
  const ors = [`location_text.ilike.%${t}%`, `card_ref.ilike.%${t}%`];
  if (f.searchVehicleIds?.length) ors.push(`vehicle_id.in.(${f.searchVehicleIds.join(",")})`);
  if (f.searchDriverIds?.length) ors.push(`driver_id.in.(${f.searchDriverIds.join(",")})`);
  return ors.join(",");
}

/**
 * The vehicle ids behind a set of unit numbers, resolved against the fleet.
 *
 * ⚠ Three outcomes, and the middle one is the whole design. `undefined` when no unit is named — the
 * whole fleet, no predicate at all. An EMPTY ARRAY when units ARE named and none of them is a truck
 * this org has, which is the true answer and not the same thing: PostgREST renders it
 * `vehicle_id=in.()` and returns nothing, and `fuel_range_totals` reads an empty `p_vehicles` the same
 * way (migration 0312). Falling back to `undefined` there would show the WHOLE fleet's fills under a
 * filter bar naming two trucks — the confidently-wrong answer FUEL-T5 spent a step removing.
 *
 * The screen and the export both call this, so a URL that narrows a page narrows its file identically.
 */
export function vehicleIdsForUnits(
  units: readonly string[],
  vehicles: readonly { id: string; unit_number: string }[],
): string[] | undefined {
  if (units.length === 0) return undefined;
  const wanted = new Set(units);
  return vehicles.filter((v) => wanted.has(v.unit_number)).map((v) => v.id);
}

/**
 * Which vehicles and drivers a typed search term names, resolved against the roster it is searching.
 *
 * The Fills tab resolves the term in the browser so its query can OR a unit number or a driver name
 * into a location/card match. The export has to resolve it the SAME way or the file and the screen
 * answer different questions for the same URL — so the RULE lives here and each layer supplies the
 * roster it already holds.
 */
export function matchSearchIds(
  term: string | null,
  vehicles: readonly { id: string; unit_number: string }[],
  drivers: readonly { id: string; full_name: string }[],
): { searchVehicleIds?: string[]; searchDriverIds?: string[] } {
  const t = (term ?? "").trim().toLowerCase();
  if (!t) return {};
  const vIds = vehicles.filter((v) => v.unit_number.toLowerCase().includes(t)).map((v) => v.id);
  const dIds = drivers.filter((d) => d.full_name.toLowerCase().includes(t)).map((d) => d.id);
  return {
    ...(vIds.length ? { searchVehicleIds: vIds } : {}),
    ...(dIds.length ? { searchDriverIds: dIds } : {}),
  };
}
