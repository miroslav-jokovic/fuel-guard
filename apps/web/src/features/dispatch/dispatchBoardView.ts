import {
  availableNear,
  legalDriveMs,
  needsAttention,
  warningIsUrgent,
  type DispatchBoardRow,
  type DispatchScope,
  type BoardWarning,
  type SavedViewTable,
} from "@silvicom/shared";
import { type DataTableColumn } from "@silvicom/ui";
import { formatDate } from "@/lib/format";
import { POOL_FLEET, admitsScope, type ScopeFilter } from "./dispatchScope";

export { NO_FLEET_OPTION, POOL_FLEET, POOL_OPTION, dispatcherName } from "./dispatchScope";

/**
 * How the dispatch board page narrows and words its rows (DISPATCH-BOARD-PLAN §5). Every VERDICT on a
 * row is the server's (`@silvicom/shared` `dispatchBoard.ts`); this file only decides which rows to
 * show and how to say a number, so it can be tested without rendering a table.
 */

/**
 * The queues — each a predicate over the server's flags, defined once (plan §4 #5).
 *
 * The board SHOWS three of them as tabs (`BOARD_TABS`, DISPATCH-BOARD-V2-PLAN D-DBV2): the dispatchers
 * found seven tabs confusing (2026-10-15), and the two questions they work from are "which trucks need
 * a load" and "which have a problem". The narrow ones stay queues because the Operations cards count
 * by them and open the board on them (FLEET-MANAGER-HOME-PLAN D-FM7: the number on the card is the
 * rows behind its door) — a narrow queue a link opens is shown as a tab of its own while it is in force.
 */
export const BOARD_QUEUES = [
  { value: "all", label: "All trucks", test: () => true },
  { value: "needs-load", label: "Needs a load", test: (r: DispatchBoardRow) => !r.inShop && (r.flags.emptyNow || r.flags.noNextLoad) },
  { value: "attention", label: "Needs attention", test: (r: DispatchBoardRow) => needsAttention(r.flags) },
  { value: "late", label: "Late risk", test: (r: DispatchBoardRow) => r.flags.lateRisk },
  { value: "no-next", label: "No next load", test: (r: DispatchBoardRow) => r.flags.noNextLoad },
  { value: "empty", label: "Empty now", test: (r: DispatchBoardRow) => r.flags.emptyNow },
  { value: "hos-low", label: "HOS low", test: (r: DispatchBoardRow) => r.flags.hosLow },
  { value: "no-gps", label: "No GPS", test: (r: DispatchBoardRow) => r.flags.noGps },
] as const;
export type BoardQueue = (typeof BOARD_QUEUES)[number]["value"];
export const BOARD_TABS: readonly BoardQueue[] = ["all", "needs-load", "attention"];

/**
 * "Which trucks will be free in Florida, near Orlando, within a day?" (D-DBV3) — the dispatchers' own
 * board's `fl` box, made precise. `near` is a point already resolved from a city the board knows
 * (`knownCityPoints`); `withinHours` is a horizon from now, not a date, so a saved view of "free within
 * 24 h" means the same thing tomorrow.
 */
export interface AvailableFilter {
  states: string[];
  near: { lat: number; lng: number; radiusMiles: number } | null;
  withinHours: number | null;
}
export const NO_AVAILABLE_FILTER: AvailableFilter = { states: [], near: null, withinHours: null };

export interface BoardFilter extends ScopeFilter {
  queue: BoardQueue;
  search: string;
  available?: AvailableFilter;
}

/** The rows a filter admits, in the order given. `now` sets the "within N hours" horizon. */
export function filterBoard(
  rows: readonly DispatchBoardRow[],
  scope: DispatchScope,
  f: BoardFilter,
  now: Date = new Date(),
): DispatchBoardRow[] {
  const queue = BOARD_QUEUES.find((q) => q.value === f.queue) ?? BOARD_QUEUES[0];
  const term = f.search.trim().toLowerCase();
  const a = f.available ?? NO_AVAILABLE_FILTER;
  const by = a.withinHours != null ? new Date(now.getTime() + a.withinHours * 3_600_000).toISOString() : null;
  return rows.filter((r) => {
    if (!admitsScope(r, scope, f)) return false;
    // "All" still leaves the parked pool out unless it is asked for by name. A board rule, not a scope
    // rule: a truck parked in the shop is not work, but a load on the Loads page is a record and stays.
    if (!f.mine && !f.fleet && r.fleetCode === POOL_FLEET) return false;
    if (!queue.test(r)) return false;
    // A truck in the shop is not available anywhere, whatever its last position says.
    if ((a.states.length || a.near || by) && (r.inShop || !availableNear(r.available, { states: a.states, near: a.near, by }))) return false;
    if (!term) return true;
    return [
      r.unitNumber, r.fleetCode, r.driver?.name, r.current?.ref, r.current?.customerName, r.current?.trailerUnit,
      r.position?.place, r.current?.nextStop?.city, r.available?.city, r.available?.state, r.available?.postalCode, r.next?.ref,
    ]
      .filter((v): v is string => Boolean(v))
      .some((v) => v.toLowerCase().includes(term));
  });
}

/**
 * Trucks per dispatcher, in numbers (the owner, 2026-10-15: "we have that but it is not transparent in
 * numbers"). One count per fleet code, and of those how many are empty now — the figure a dispatcher
 * plans the morning from. Counted from the board's own rows, so the census and the table cannot disagree.
 */
export function fleetCensus(rows: readonly DispatchBoardRow[]): Map<string | null, { trucks: number; empty: number }> {
  const out = new Map<string | null, { trucks: number; empty: number }>();
  for (const r of rows) {
    const c = out.get(r.fleetCode) ?? { trucks: 0, empty: 0 };
    c.trucks += 1;
    if (r.flags.emptyNow) c.empty += 1;
    out.set(r.fleetCode, c);
  }
  return out;
}

/**
 * Available's colour, the dispatchers' habit carried over (Q-DBV5): red when the truck is free now or
 * already should have been — it needs a load — amber within a day, green later. In the shop, or no
 * time at all, is no colour: there is nothing to plan.
 */
export const AVAILABLE_SOON_MS = 24 * 3_600_000;
export function availableTone(r: DispatchBoardRow, now: Date): "danger" | "warning" | "success" | "neutral" {
  if (r.inShop || !r.available?.at) return "neutral";
  const ms = Date.parse(r.available.at) - now.getTime();
  if (ms <= 0) return "danger";
  return ms <= AVAILABLE_SOON_MS ? "warning" : "success";
}

/**
 * The columns, in the order the dispatchers' own board reads (DISPATCH-BOARD-V2-PLAN D-DBV1): who, whose,
 * when and where it is free, how far it still has to drive, and its state. Seven facts a row where there
 * were eighteen; what left the row went to the drawer, one click away.
 *
 * Widths are budgeted to fit the table's 1104 px at a 1440 px screen with the sidebar open (measured
 * 2026-10-10, when a first cut at 1664 px hid the columns the board exists for): the defaults, Warnings
 * (DBV3) included, sum to 976 px. Cells wrap rather than widen.
 *
 * The LIVE columns — HOS, Now, Current load, Next stop, Next load — are the old board's, and stay one
 * tick away in the column picker for whoever runs the dense board (`BOARD_LIVE_COLUMNS`, hidden by
 * default). Every column sorts, by the quantity its words describe (`boardSortValue`).
 */
export const BOARD_COLUMNS: DataTableColumn[] = [
  { key: "unit", label: "Truck", width: "sm", sortable: true, cellClass: "font-medium text-ink" },
  { key: "driver", label: "Driver", width: "md", sortable: true },
  { key: "dispatcher", label: "Dispatcher", width: "sm", sortable: true },
  { key: "available", label: "Available", width: "md", sortable: true },
  { key: "availableIn", label: "Available in", width: "lg", sortable: true },
  { key: "milesLeft", label: "Miles left", width: "sm", sortable: true, numeric: true },
  { key: "status", label: "Status", width: "md", sortable: true },
  { key: "warnings", label: "Warnings", width: "md", sortable: true },
  { key: "hos", label: "HOS", width: "sm", sortable: true },
  { key: "now", label: "Now", width: "md", sortable: true },
  { key: "load", label: "Current load", width: "md", sortable: true },
  { key: "nextStop", label: "Next stop", width: "md", sortable: true },
  { key: "next", label: "Next load", width: "sm", sortable: true },
];
export const BOARD_LIVE_COLUMNS = ["hos", "now", "load", "nextStop", "next"] as const;

/**
 * The board's table id, from the one place it is spelled (`SAVED_VIEW_TABLES`): the column picker's
 * storage key (`fg.cols.dispatch.board`) and the saved views' `table_id` (admitted by migration 0452),
 * so the two agree about what "the board" is called by construction.
 */
export const BOARD_TABLE: SavedViewTable = "dispatch.board";
/**
 * The column picker's storage id, versioned apart from the views' table id: a reader who set columns on
 * the v1 board stored a hidden-list for nine columns, and reading it here would show them every Live
 * column again. Saved views keep `BOARD_TABLE`, the id migration 0452 admitted.
 */
export const BOARD_COLUMNS_ID = `${BOARD_TABLE}.v2`;

/** The column keys a `?sort=` link may name — derived, so a new sortable column cannot be forgotten. */
export const BOARD_SORT_KEYS = BOARD_COLUMNS.filter((c) => c.sortable).map((c) => c.key);
/** The board opens soonest-free first, as the dispatchers' own board does. */
export const BOARD_DEFAULT_SORT = "available";

/**
 * What each board column sorts by (`sortRows` accessor). A cell shows words; it sorts by the quantity
 * the words describe — drive time left, the stop's appointment, when the truck empties — so "2h 05m"
 * sorts below "10h 00m" and "Thu 10/09" before "Fri 10/10".
 *
 * Status sorts by what needs a dispatcher first: empty, then late, at risk, on time, no verdict, and the
 * shop last, because the reason to sort that column is to bring the trucks that need a load or will miss
 * an appointment to the top.
 */
const ON_TIME_RANK: Record<string, number> = { late: 0, at_risk: 1, on_time: 2 };
export function boardSortValue(r: DispatchBoardRow, key: string): unknown {
  switch (key) {
    case "unit":
      return r.unitNumber;
    case "driver":
      return r.driver?.name ?? r.current?.driverName ?? null;
    case "dispatcher":
      return r.fleetCode;
    case "available":
      return r.inShop ? null : (r.available?.at ?? null);
    case "availableIn":
      return r.available ? [r.available.state, r.available.city].filter(Boolean).join(" ") || null : null;
    case "milesLeft":
      return r.milesLeft;
    case "warnings":
      // Most pressing first: an urgent item (overdue, or a random test) counts three times a due one.
      return r.warnings.length ? r.warnings.reduce((n, w) => n + (warningIsUrgent(w) ? 3 : 1), 0) * -1 : null;
    case "status":
      return r.inShop ? 4 : !r.current ? 0 : (ON_TIME_RANK[r.onTime] ?? 3) + 0.5;
    case "hos":
      return legalDriveLeft(r);
    case "now":
      return r.position?.place ?? null;
    case "load":
      return r.current?.ref ?? null;
    case "nextStop":
      return r.current?.nextStop?.appointmentEnd ?? r.current?.nextStop?.appointmentStart ?? null;
    case "next":
      return r.next?.ref ?? null;
    default:
      return null;
  }
}

/** "5h 12m", "45m", or "—". */
export function durationWords(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** The binding clock, the one that ends the driver's day first — the number a dispatcher plans with. */
export function legalDriveLeft(r: DispatchBoardRow): number | null {
  return r.hos ? legalDriveMs({ ...r.hos, timeUntilBreakMs: r.hos.breakRemainingMs }) : null;
}

/** How old the GPS fix is, in the words the board uses: "now", "4 min", "3 h", "2 d". */
export function gpsAgeWords(seconds: number | null | undefined): string {
  if (seconds == null) return "no fix";
  if (seconds < 90) return "now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** "Lakeland, FL 33801" — where the truck is next free, ZIP included as the dispatchers' board shows it. */
export function availablePlace(r: DispatchBoardRow): string {
  const a = r.available;
  if (!a) return "";
  const region = [a.state, a.postalCode].filter(Boolean).join(" ");
  return [a.city, region].filter(Boolean).join(", ") || a.place || "";
}

/**
 * One warning in the dispatchers' words (D-DBV5, DBV4): "Random test: send to collection", "Med card
 * expired 10/01/2026", "CDL expires 11/02/2026", "Annual overdue 09/30/2026", "6-month due 11/01/2026",
 * "Oil in 1,133 mi", "Oil 5,062 mi over", "Repair order open" — the trailer's prefixed "Trailer".
 */
const KIND_WORDS: Record<BoardWarning["kind"], string> = {
  random_test: "Random test", medical_card: "Med card", cdl: "CDL", annual: "Annual", six_month: "6-month", oil: "Oil", repair_order: "Repair order",
};
export function warningWords(w: BoardWarning): string {
  // The redacted fact, and nothing else: no date, no pool, no result (Q-DBV3).
  if (w.kind === "random_test") return "Random test: send to collection";
  // A licence or a card expires; a dated inspection falls due.
  if (w.kind === "medical_card" || w.kind === "cdl") {
    return `${KIND_WORDS[w.kind]} ${w.verdict === "overdue" ? "expired" : "expires"}${w.dueOn ? ` ${formatDate(w.dueOn)}` : ""}`;
  }
  const what = `${w.unit === "trailer" ? "Trailer " : ""}${w.unit === "trailer" ? KIND_WORDS[w.kind].toLowerCase() : KIND_WORDS[w.kind]}`;
  if (w.kind === "repair_order") return `${what} open`;
  if (w.milesLeft != null) {
    const mi = Math.abs(w.milesLeft).toLocaleString("en-US");
    return w.verdict === "overdue" ? `${what} ${mi} mi over` : `${what} in ${mi} mi`;
  }
  return `${what} ${w.verdict}${w.dueOn ? ` ${formatDate(w.dueOn)}` : ""}`;
}

/** "≈ 412 mi" — the v1 estimate says it is one (Q-DBV4). */
export function milesLeftWords(miles: number | null): string {
  return miles == null ? "—" : `≈ ${miles.toLocaleString("en-US")} mi`;
}

/** "Indianapolis, IN" from a stop's parts, or the place name when the city is missing. */
export function stopPlace(s: { city: string | null; state: string | null; name: string | null } | null | undefined): string {
  if (!s) return "";
  return [s.city, s.state].filter(Boolean).join(", ") || s.name || "";
}


/** A Loads-page stop as the board names it: McLeod's real location name first, then the stop's own name. */
export function loadStopName(s: { location_name?: string | null; name: string | null } | null | undefined): string {
  return s ? s.location_name || s.name || "" : "";
}
